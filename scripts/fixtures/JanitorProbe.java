package org.killbill.billing.payment.core.janitor;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.joda.time.DateTime;
import org.joda.time.DateTimeZone;
import org.killbill.billing.account.api.AccountInternalApi;
import org.killbill.billing.account.api.ImmutableAccountData;
import org.killbill.billing.callcontext.InternalCallContext;
import org.killbill.billing.callcontext.InternalTenantContext;
import org.killbill.billing.catalog.api.Currency;
import org.killbill.billing.payment.api.TransactionStatus;
import org.killbill.billing.payment.api.TransactionType;
import org.killbill.billing.payment.core.sm.PaymentAutomatonDAOHelper;
import org.killbill.billing.payment.core.sm.PaymentStateMachineHelper;
import org.killbill.billing.payment.dao.PaymentAndTransactionModelDao;
import org.killbill.billing.payment.dao.PaymentDao;
import org.killbill.billing.payment.dao.PaymentModelDao;
import org.killbill.billing.payment.dao.PaymentTransactionModelDao;
import org.killbill.billing.payment.plugin.api.PaymentPluginStatus;
import org.killbill.billing.payment.provider.DefaultNoOpPaymentInfoPlugin;
import org.killbill.billing.util.callcontext.CallOrigin;
import org.killbill.billing.util.callcontext.InternalCallContextFactory;
import org.killbill.billing.util.callcontext.UserType;
import org.killbill.billing.util.config.definition.PaymentConfig;
import org.killbill.commons.locker.GlobalLock;
import org.killbill.commons.locker.GlobalLocker;
import org.killbill.commons.locker.LockFailedException;
import org.mockito.Answers;
import org.mockito.Mockito;

/** Feasibility observer, not an Agent answer or a replacement recovery algorithm. */
public final class JanitorProbe {
    static final UUID ACCOUNT = UUID.fromString("00000000-0000-0000-0000-000000000001");
    static final UUID PAYMENT = UUID.fromString("00000000-0000-0000-0000-000000000002");
    static final UUID AUTH = UUID.fromString("00000000-0000-0000-0000-000000000003");
    static final UUID CAPTURE = UUID.fromString("00000000-0000-0000-0000-000000000004");
    static final DateTime NOW = new DateTime(2026, 9, 9, 0, 0, DateTimeZone.UTC);
    static final BigDecimal TEN = new BigDecimal("10.00");

    static final class Store {
        final List<String> trace = new ArrayList<>();
        TransactionStatus status;
        String paymentState;
        String lastSuccess;
        BigDecimal processed = BigDecimal.ZERO;
        Currency processedCurrency = Currency.EUR;
        int transactionCount = 1, updates = 0, readsBeforeLock = 0, readsInsideLock = 0;
        int acquired = 0, released = 0;
        boolean held = false;

        Store(boolean pending) {
            status = pending ? TransactionStatus.PENDING : TransactionStatus.UNKNOWN;
            paymentState = pending ? "AUTH_PENDING" : "AUTH_ERRORED";
        }
        PaymentTransactionModelDao snapshot() {
            PaymentTransactionModelDao result = new PaymentTransactionModelDao(AUTH, (UUID) null,
                    "auth-key", NOW, NOW, PAYMENT, TransactionType.AUTHORIZE, NOW, status, TEN,
                    Currency.EUR, null, null);
            result.setProcessedAmount(processed);
            result.setProcessedCurrency(processedCurrency);
            return result;
        }
        PaymentModelDao paymentSnapshot() {
            PaymentModelDao p = new PaymentModelDao(PAYMENT, NOW, NOW, ACCOUNT, ACCOUNT, "payment-key");
            p.setStateName(paymentState);
            p.setLastSuccessStateName(lastSuccess);
            return p;
        }
        void concurrentCapture() {
            // Happens before the candidate obtains the account lock. Existing snapshots stay detached.
            status = TransactionStatus.SUCCESS;
            paymentState = "CAPTURE_SUCCESS";
            lastSuccess = "CAPTURE_SUCCESS";
            processed = TEN;
            transactionCount = 2;
            trace.add("other-operation:AUTH_SUCCESS->CAPTURE_SUCCESS");
        }
    }

    static Map<String, Object> run(String scenario) throws Exception {
        Store store = new Store(scenario.equals("pending_unchanged"));
        PaymentTransactionModelDao initialSnapshot = store.snapshot();
        TransactionStatus initial = store.status;
        PaymentDao dao = Mockito.mock(PaymentDao.class, call -> {
            String method = call.getMethod().getName();
            if (method.equals("getPaymentTransaction")) {
                if (!AUTH.equals(call.getArgument(0))) throw new AssertionError("unexpected transaction identity");
                if (store.held) store.readsInsideLock++; else store.readsBeforeLock++;
                store.trace.add("read:" + (store.held ? "locked:" : "unlocked:") + store.status);
                return store.snapshot();
            }
            if (method.equals("updatePaymentAndTransactionOnCompletion")) {
                if (!store.held) throw new AssertionError("write without account lock");
                Object[] a = call.getArguments();
                boolean withLastSuccess = a.length == 14;
                if (!withLastSuccess && a.length != 13) throw new AssertionError("DAO signature drift");
                int offset = withLastSuccess ? 1 : 0;
                if (!ACCOUNT.equals(a[0]) || !PAYMENT.equals(a[2]) || !AUTH.equals(a[5 + offset]))
                    throw new AssertionError("write identity mismatch");
                // Storage adapter only applies supplied columns; all business decisions remain in real helpers.
                store.paymentState = (String) a[4];
                if (withLastSuccess) store.lastSuccess = (String) a[5];
                store.status = (TransactionStatus) a[6 + offset];
                store.processed = (BigDecimal) a[7 + offset];
                store.processedCurrency = (Currency) a[8 + offset];
                store.updates++;
                store.trace.add("write:" + store.paymentState + ":" + store.status);
                PaymentAndTransactionModelDao result = new PaymentAndTransactionModelDao();
                result.setPaymentModelDao(store.paymentSnapshot());
                result.setPaymentTransactionModelDao(store.snapshot());
                return result;
            }
            throw new AssertionError("unexpected DAO operation: " + method);
        });
        ImmutableAccountData account = Mockito.mock(ImmutableAccountData.class);
        Mockito.when(account.getId()).thenReturn(ACCOUNT);
        AccountInternalApi accounts = Mockito.mock(AccountInternalApi.class, call -> {
            if (call.getMethod().getName().equals("getImmutableAccountDataByRecordId")) return account;
            throw new AssertionError("unexpected account operation");
        });
        PaymentConfig config = Mockito.mock(PaymentConfig.class);
        Mockito.when(config.getMaxGlobalLockRetries()).thenReturn(1);
        GlobalLock lock = Mockito.mock(GlobalLock.class, call -> {
            if (call.getMethod().getName().equals("release")) {
                if (!store.held) throw new AssertionError("release without lock");
                store.held = false; store.released++; store.trace.add("released"); return null;
            }
            return Answers.RETURNS_DEFAULTS.answer(call);
        });
        GlobalLocker locker = Mockito.mock(GlobalLocker.class, call -> {
            if (!call.getMethod().getName().equals("lockWithNumberOfTries"))
                throw new AssertionError("unexpected lock operation");
            if (!ACCOUNT.toString().equals(call.getArgument(1))) throw new AssertionError("wrong account lock");
            store.trace.add("lock-requested");
            if (scenario.equals("lock_failure")) throw Mockito.mock(LockFailedException.class);
            if (scenario.equals("concurrent_capture")) store.concurrentCapture();
            store.held = true; store.acquired++; store.trace.add("acquired"); return lock;
        });
        InternalTenantContext context = new InternalTenantContext(1L, 2L, DateTimeZone.UTC, DateTimeZone.UTC, NOW);
        InternalCallContextFactory contexts = new InternalCallContextFactory(null, null, null, null) {
            @Override
            public InternalCallContext createInternalCallContext(Long tenant, Long accountRecord,
                    String userName, CallOrigin origin, UserType userType, UUID token) {
                return new InternalCallContext(tenant, accountRecord, DateTimeZone.UTC, DateTimeZone.UTC,
                        NOW, token, userName, origin, userType, null, null, NOW, NOW);
            }
        };
        PaymentPluginStatus pluginStatus = scenario.equals("unresolved") ? PaymentPluginStatus.UNDEFINED
                : scenario.equals("pending_unchanged") ? PaymentPluginStatus.PENDING : PaymentPluginStatus.PROCESSED;
        DefaultNoOpPaymentInfoPlugin pluginResult = new DefaultNoOpPaymentInfoPlugin(PAYMENT, AUTH,
                TransactionType.AUTHORIZE, TEN, Currency.EUR, NOW, NOW, pluginStatus, null, null);
        // The on-the-fly route already has a plugin observation. Plugin retrieval is deliberately not simulated.
        IncompletePaymentTransactionTask task = new IncompletePaymentTransactionTask(contexts, config,
                dao, new PaymentStateMachineHelper(null), accounts, null, locker);
        boolean changed = task.updatePaymentAndTransactionIfNeeded(ACCOUNT, AUTH, initial, pluginResult, true, context);
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("scenario", scenario); result.put("payment_state", store.paymentState);
        result.put("last_success", store.lastSuccess); result.put("transaction_status", store.status.toString());
        result.put("processed_amount", store.processed.toPlainString()); result.put("processed_currency", store.processedCurrency.toString());
        result.put("transaction_count", store.transactionCount); result.put("transaction_id", AUTH.toString());
        result.put("updates", store.updates); result.put("reads_before_lock", store.readsBeforeLock);
        result.put("reads_inside_lock", store.readsInsideLock); result.put("acquired", store.acquired);
        result.put("released", store.released); result.put("lock_held", store.held); result.put("changed", changed);
        result.put("old_snapshot_unchanged", initialSnapshot.getTransactionStatus() == initial);
        result.put("trace", store.trace);
        return result;
    }

    static String json(Object value) {
        if (value == null) return "null";
        if (value instanceof Number || value instanceof Boolean) return value.toString();
        if (value instanceof Map) {
            List<String> fields = new ArrayList<>();
            ((Map<?, ?>) value).forEach((k,v) -> fields.add(json(k) + ":" + json(v)));
            return "{" + String.join(",", fields) + "}";
        }
        if (value instanceof List) {
            List<String> values = new ArrayList<>(); for (Object v : (List<?>) value) values.add(json(v));
            return "[" + String.join(",", values) + "]";
        }
        return "\"" + value.toString().replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", "\\n") + "\"";
    }

    public static void main(String[] args) throws Exception {
        String expectedClasses = new java.io.File(args[0]).getCanonicalFile().toURI().toString();
        String candidateOrigin = IncompletePaymentTransactionTask.class.getProtectionDomain().getCodeSource().getLocation().toString();
        if (!candidateOrigin.equals(expectedClasses)) throw new AssertionError("candidate source shadowed by dependency jar");
        String helperOrigin = PaymentAutomatonDAOHelper.class.getProtectionDomain().getCodeSource().getLocation().toString();
        if (!helperOrigin.endsWith("/killbill-payment-0.24.21.jar")) throw new AssertionError("real DAO helper not loaded");
        String token = UUID.randomUUID().toString();
        System.out.println("BEGIN\t" + token);
        for (String scenario : List.of("concurrent_capture", "normal_recovery", "unresolved", "pending_unchanged", "lock_failure"))
            System.out.println(token + "\t" + json(run(scenario)));
        System.out.println("END\t" + token);
    }
}
