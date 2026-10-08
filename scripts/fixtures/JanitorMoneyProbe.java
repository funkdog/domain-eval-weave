package org.killbill.billing.payment.core.janitor;

import static org.killbill.billing.payment.core.janitor.JanitorProbe.*;

import java.math.BigDecimal;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.joda.time.DateTimeZone;
import org.killbill.billing.account.api.AccountInternalApi;
import org.killbill.billing.account.api.ImmutableAccountData;
import org.killbill.billing.callcontext.InternalCallContext;
import org.killbill.billing.callcontext.InternalTenantContext;
import org.killbill.billing.catalog.api.Currency;
import org.killbill.billing.payment.api.TransactionStatus;
import org.killbill.billing.payment.core.sm.PaymentAutomatonDAOHelper;
import org.killbill.billing.payment.core.sm.PaymentStateMachineHelper;
import org.killbill.billing.payment.dao.PaymentAndTransactionModelDao;
import org.killbill.billing.payment.dao.PaymentDao;
import org.killbill.billing.payment.dao.PaymentTransactionModelDao;
import org.killbill.billing.payment.plugin.api.PaymentPluginStatus;
import org.killbill.billing.payment.provider.DefaultNoOpPaymentInfoPlugin;
import org.killbill.billing.util.callcontext.CallOrigin;
import org.killbill.billing.util.callcontext.InternalCallContextFactory;
import org.killbill.billing.util.callcontext.UserType;
import org.killbill.billing.util.config.definition.PaymentConfig;
import org.killbill.commons.locker.GlobalLock;
import org.killbill.commons.locker.GlobalLocker;
import org.mockito.Answers;
import org.mockito.Mockito;

/** Author-side observation fixture. It records actual helper writes, not its own grade. */
public final class JanitorMoneyProbe {
    static Map<String, Object> money(String name) throws Exception {
        boolean zeroPrior = name.equals("success_with_zero_default");
        Store store = new Store(!zeroPrior);
        store.processed = zeroPrior ? BigDecimal.ZERO : new BigDecimal("3.00");
        store.processedCurrency = zeroPrior ? Currency.EUR : Currency.USD;
        TransactionStatus initial = store.status;
        PaymentTransactionModelDao detached = store.snapshot();
        BigDecimal amount = name.equals("explicit_override") || name.equals("currency_absent")
                ? new BigDecimal("4.00") : name.equals("zero_is_present") ? BigDecimal.ZERO
                : name.equals("pending_same_no_write") ? new BigDecimal("9.00") : null;
        Currency currency = name.equals("amount_absent") || name.equals("explicit_override")
                || name.equals("zero_is_present") || name.equals("pending_same_no_write") ? Currency.EUR : null;
        PaymentPluginStatus pluginStatus = name.equals("pending_same_no_write")
                ? PaymentPluginStatus.PENDING : PaymentPluginStatus.PROCESSED;
        PaymentDao dao = Mockito.mock(PaymentDao.class, call -> {
            if (call.getMethod().getName().equals("getPaymentTransaction")) {
                if (!AUTH.equals(call.getArgument(0))) throw new AssertionError("wrong read identity");
                if (store.held) store.readsInsideLock++; else store.readsBeforeLock++;
                store.trace.add("read:" + (store.held ? "locked:" : "unlocked:") + store.status);
                return store.snapshot();
            }
            if (call.getMethod().getName().equals("updatePaymentAndTransactionOnCompletion")) {
                if (!store.held) throw new AssertionError("write without account lock");
                Object[] a = call.getArguments();
                boolean withLastSuccess = a.length == 14;
                if (!withLastSuccess && a.length != 13) throw new AssertionError("DAO signature drift");
                int offset = withLastSuccess ? 1 : 0;
                if (!ACCOUNT.equals(a[0]) || !PAYMENT.equals(a[2]) || !AUTH.equals(a[5 + offset]))
                    throw new AssertionError("write identity mismatch");
                store.paymentState = (String) a[4];
                if (withLastSuccess) store.lastSuccess = (String) a[5];
                store.status = (TransactionStatus) a[6 + offset];
                store.processed = (BigDecimal) a[7 + offset];
                store.processedCurrency = (Currency) a[8 + offset];
                store.updates++;
                store.trace.add("write:" + store.paymentState + ":" + store.status);
                PaymentAndTransactionModelDao out = new PaymentAndTransactionModelDao();
                out.setPaymentModelDao(store.paymentSnapshot());
                out.setPaymentTransactionModelDao(store.snapshot());
                return out;
            }
            throw new AssertionError("unexpected DAO operation: " + call.getMethod().getName());
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
            if (!call.getMethod().getName().equals("lockWithNumberOfTries")
                    || !ACCOUNT.toString().equals(call.getArgument(1))) throw new AssertionError("wrong lock operation");
            store.held = true; store.acquired++; store.trace.add("acquired"); return lock;
        });
        InternalTenantContext context = new InternalTenantContext(1L, 2L, DateTimeZone.UTC, DateTimeZone.UTC, NOW);
        InternalCallContextFactory contexts = new InternalCallContextFactory(null, null, null, null) {
            @Override
            public InternalCallContext createInternalCallContext(Long tenant, Long accountRecord,
                    String userName, CallOrigin origin, UserType userType, UUID userToken) {
                return new InternalCallContext(tenant, accountRecord, DateTimeZone.UTC, DateTimeZone.UTC,
                        NOW, userToken, userName, origin, userType, null, null, NOW, NOW);
            }
        };
        DefaultNoOpPaymentInfoPlugin plugin = new DefaultNoOpPaymentInfoPlugin(PAYMENT, AUTH,
                org.killbill.billing.payment.api.TransactionType.AUTHORIZE, amount, currency,
                NOW, NOW, pluginStatus, null, null);
        IncompletePaymentTransactionTask task = new IncompletePaymentTransactionTask(contexts, config,
                dao, new PaymentStateMachineHelper(null), accounts, null, locker);
        boolean changed = task.updatePaymentAndTransactionIfNeeded(ACCOUNT, AUTH, initial, plugin, true, context);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("scenario", name); out.put("prior_status", initial.toString());
        out.put("requested_amount", detached.getAmount().toPlainString());
        out.put("requested_currency", detached.getCurrency().toString());
        out.put("prior_amount", detached.getProcessedAmount().toPlainString());
        out.put("prior_currency", detached.getProcessedCurrency().toString());
        out.put("plugin_amount", amount == null ? null : amount.toPlainString());
        out.put("plugin_currency", currency == null ? null : currency.toString());
        out.put("payment_state", store.paymentState); out.put("last_success", store.lastSuccess);
        out.put("transaction_status", store.status.toString());
        out.put("processed_amount", store.processed == null ? null : store.processed.toPlainString());
        out.put("processed_currency", store.processedCurrency == null ? null : store.processedCurrency.toString());
        out.put("updates", store.updates); out.put("changed", changed);
        out.put("transaction_id", AUTH.toString()); out.put("old_snapshot_unchanged", detached.getTransactionStatus() == initial);
        out.put("lock_held", store.held); out.put("acquired", store.acquired); out.put("released", store.released);
        out.put("trace", store.trace);
        return out;
    }

    public static void main(String[] args) throws Exception {
        String classes = new java.io.File(args[0]).getCanonicalFile().toURI().toString();
        if (!IncompletePaymentTransactionTask.class.getProtectionDomain().getCodeSource().getLocation().toString().equals(classes))
            throw new AssertionError("candidate source shadowed");
        if (!PaymentAutomatonDAOHelper.class.getProtectionDomain().getCodeSource().getLocation().toString().endsWith("/killbill-payment-0.24.21.jar"))
            throw new AssertionError("real helper not loaded");
        String nonce = UUID.randomUUID().toString();
        System.out.println("BEGIN\t" + nonce);
        for (String s : List.of("concurrent_capture", "normal_recovery", "unresolved", "pending_unchanged", "lock_failure"))
            System.out.println(nonce + "\t" + json(JanitorProbe.run(s)));
        for (String s : List.of("both_absent_existing", "amount_absent", "currency_absent", "explicit_override",
                "zero_is_present", "success_with_zero_default", "pending_same_no_write"))
            System.out.println(nonce + "\t" + json(money(s)));
        System.out.println("END\t" + nonce);
    }
}
