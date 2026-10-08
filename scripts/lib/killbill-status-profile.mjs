import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { StrictProcessRunner } from "../../legacy/dsh-eval-lab/src/process/strict-runner.ts";
import { canonicalJsonDigest, sha256Hex } from "../../packages/weave/src/canonical-json.ts";
import { writeExclusiveOrVerify } from "../../packages/weave/src/capsule/artifact-store.ts";

export const dependencies = {
  "killbill-api-0.54.0.jar": "43cdfce3782742e111aaebf7e3c411c3dff1ded09892e44e319c1b1d905f89de",
  "killbill-automaton-0.26.15.jar":
    "de21cb70fca2a855a599770a67abae37e57951d6a7fe39545d5ef56939ca62cc",
  "joda-time-2.12.5.jar": "10628411ecb40c4634196c544f34681abdeef826f377096357433d1f9a135bc6",
};

export const candidateName = "PaymentTransactionInfoPluginConverter.java";
export async function loadStatusSources() {
  const sourceBytes = await readFile(
    new URL(
      "../../packages/weave/examples/killbill-orchestration/sources/core.json",
      import.meta.url,
    ),
  );
  assert.equal(
    sha256Hex(sourceBytes),
    "a6848aa19ba4b8483f8798f65aa68bc11aae43949637a82a33a825ec8544bebf",
  );
  const bundle = JSON.parse(sourceBytes.toString("utf8"));
  assert.equal(bundle.revision, "5da9650de60b2fa83dea556d7e95c70b79dabd39");
  const sourcePath =
    "payment/src/main/java/org/killbill/billing/payment/core/PaymentTransactionInfoPluginConverter.java";
  const reference = bundle.files.find((file) => file.path === sourcePath).content;
  const expression =
    "Objects.requireNonNullElse(paymentTransactionInfoPlugin.getStatus(), PaymentPluginStatus.UNDEFINED)";
  assert.equal(
    reference.split(expression).length,
    3,
    "two upstream methods must be identified exactly",
  );
  const prefix = `final PaymentPluginStatus status = ${expression};\n        switch (status)`;
  assert.equal(reference.split(prefix).length, 3);
  const variants = {
    upstream_reference: reference,
    seeded_regression: reference.replaceAll(
      prefix,
      "switch (paymentTransactionInfoPlugin.getStatus())",
    ),
    authored_equivalent: reference.replaceAll(
      expression,
      "java.util.Optional.ofNullable(paymentTransactionInfoPlugin.getStatus()).orElse(PaymentPluginStatus.UNDEFINED)",
    ),
  };

  const license = bundle.files.find((file) => file.path === "LICENSE").content;
  return { revision: bundle.revision, sourcePath, reference, variants, license };
}

export const driver = `import java.lang.reflect.Proxy;
import java.io.PrintStream;
import java.util.UUID;
import java.util.ArrayList;
import java.util.List;
import org.killbill.billing.payment.core.PaymentTransactionInfoPluginConverter;
import org.killbill.billing.payment.plugin.api.PaymentPluginStatus;
import org.killbill.billing.payment.plugin.api.PaymentTransactionInfoPlugin;

public class StatusProbe {
  public static void main(String[] args) {
    final PrintStream output = System.out;
    final String token = UUID.randomUUID().toString();
    output.println("BEGIN\\t" + token);
    List<PaymentPluginStatus> statuses = new ArrayList<>(List.of(PaymentPluginStatus.values()));
    statuses.add(null);
    for (PaymentPluginStatus status : statuses) {
      PaymentTransactionInfoPlugin info = (PaymentTransactionInfoPlugin) Proxy.newProxyInstance(
          StatusProbe.class.getClassLoader(), new Class<?>[]{PaymentTransactionInfoPlugin.class},
          (proxy, method, values) -> {
            if (method.getName().equals("getStatus")) return status;
            throw new UnsupportedOperationException(method.getName());
          });
      for (String method : List.of("transaction", "operation")) {
        String observed;
        try {
          observed = method.equals("transaction")
              ? PaymentTransactionInfoPluginConverter.toTransactionStatus(info).name()
              : PaymentTransactionInfoPluginConverter.toOperationResult(info).name();
        } catch (Throwable error) {
          observed = "THREW:" + error.getClass().getName();
        }
        output.println(token + "\\t" + (status == null ? "NULL_STATUS" : status.name()) + "\\t" + method + "\\t" + observed);
      }
    }
    output.println("END\\t" + token);
  }
}
`;

export const expected = {
  PROCESSED: ["SUCCESS", "SUCCESS"],
  PENDING: ["PENDING", "PENDING"],
  ERROR: ["PAYMENT_FAILURE", "FAILURE"],
  CANCELED: ["PLUGIN_FAILURE", "EXCEPTION"],
  UNDEFINED: ["UNKNOWN", "EXCEPTION"],
  NULL_STATUS: ["UNKNOWN", "EXCEPTION"],
};

export async function verifyDependencies(directory) {
  for (const [name, hash] of Object.entries(dependencies)) {
    assert.equal(
      sha256Hex(await readFile(join(directory, name))),
      hash,
      `dependency drift: ${name}`,
    );
  }
}
export async function fingerprintJdk(jdk) {
  const files = ["release", "bin/java", "bin/javac", "lib/modules", "lib/server/libjvm.dylib"];
  const hashes = {};
  for (const file of files) hashes[file] = sha256Hex(await readFile(join(jdk, file)));
  return { files: hashes, digest: canonicalJsonDigest(hashes) };
}
const write = (path, content) =>
  writeExclusiveOrVerify(
    path,
    Buffer.from(content),
    () => new Error(`artifact collision: ${path}`),
  );

export function parseStatusOutput(stdout, expectations = expected) {
  const lines = stdout.trim().split("\n");
  const begin = lines.shift()?.split("\t");
  const end = lines.pop()?.split("\t");
  const token = begin?.[1];
  const framed =
    begin?.length === 2 &&
    begin[0] === "BEGIN" &&
    /^[0-9a-f-]{36}$/.test(token ?? "") &&
    end?.length === 2 &&
    end[0] === "END" &&
    end[1] === token;
  // Candidate logging is retained in raw stdout but is not an observation or an answer.
  const records = lines.filter((line) => line.startsWith(`${token}\t`));
  const observations = records.map((line) => {
    const [actualToken, input, method, observed, ...rest] = line.split("\t");
    const target =
      expectations[input]?.[method === "transaction" ? 0 : method === "operation" ? 1 : -1];
    return {
      input: input ?? "",
      method: method ?? "",
      observed: observed ?? "",
      expected: target ?? null,
      valid:
        framed &&
        actualToken === token &&
        rest.length === 0 &&
        target !== undefined &&
        typeof observed === "string" &&
        observed.length > 0,
    };
  });
  const valid =
    framed &&
    observations.length === Object.keys(expectations).length * 2 &&
    observations.every((row) => row.valid) &&
    new Set(observations.map((row) => `${row.input}:${row.method}`)).size === observations.length;
  return { observations, valid };
}

export async function executeStatusSource({
  source,
  workspace,
  dependencyDirectory,
  jdk,
  driverSource = driver,
  expectations = expected,
  timeoutMs = 15000,
}) {
  await verifyDependencies(dependencyDirectory);
  const dependencyPaths = Object.keys(dependencies).map((file) => join(dependencyDirectory, file));
  const classpath = dependencyPaths.join(delimiter);
  const scratch = join(workspace, "execution");
  await mkdir(workspace, { recursive: true, mode: 0o700 });
  const candidateFile = join(workspace, candidateName);
  const driverFile = join(workspace, "StatusProbe.java");
  await write(candidateFile, source);
  await write(driverFile, driverSource);
  const runner = new StrictProcessRunner();
  const common = {
    cwd: workspace,
    readableRoots: [...dependencyPaths, jdk],
    writableRoot: scratch,
    timeoutMs,
    maxOutputBytes: 128 * 1024,
  };
  const compile = await runner.run({
    ...common,
    executable: join(jdk, "bin/javac"),
    args: [
      "-proc:none",
      "--release",
      "11",
      "-classpath",
      classpath,
      "-d",
      scratch,
      candidateFile,
      driverFile,
    ],
  });
  const execution =
    compile.exitCode === 0 && !compile.timedOut && !compile.outputLimitExceeded
      ? await runner.run({
          ...common,
          executable: join(jdk, "bin/java"),
          args: [
            "-Xmx128m",
            "-XX:-UsePerfData",
            "-classpath",
            [scratch, classpath].join(delimiter),
            "StatusProbe",
          ],
        })
      : null;
  const parsed = parseStatusOutput(execution?.stdout ?? "", expectations);
  const valid =
    compile.exitCode === 0 &&
    execution?.exitCode === 0 &&
    !compile.timedOut &&
    !compile.outputLimitExceeded &&
    !execution.timedOut &&
    !execution.outputLimitExceeded &&
    parsed.valid;
  return {
    source_sha256: sha256Hex(source),
    compile,
    execution,
    measurement_valid: valid,
    observations: parsed.observations,
    mismatches: valid ? parsed.observations.filter((row) => row.observed !== row.expected) : null,
  };
}
