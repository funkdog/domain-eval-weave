import {
  CapsuleError,
  confirmCapsuleClaim,
  loadCapsule,
  readCapsuleRelease,
  releaseCapsule,
} from "../capsule/index.js";
import {
  calibrateEvaluator,
  compareEvaluators,
  evaluateCandidate,
  replayEvaluationRun,
} from "../evaluator/index.js";

export interface CapsuleCliIo {
  readonly stdout?: (text: string) => void;
  readonly stderr?: (text: string) => void;
}

const HELP = `DSH Eval Capsule

validate <capsule-root>
confirm <capsule-root> <claim-id> <owner-id>
release <capsule-root>
run <capsule-root> <requirement-id> <evaluator-id>@<version> <candidate-id>
calibrate <capsule-root> <evaluator-id>@<version>
compare <capsule-root> <requirement-id> <left-evaluator> <right-evaluator>
replay <capsule-root> <run-ref>
`;

function output(io: CapsuleCliIo, value: unknown): void {
  (io.stdout ?? process.stdout.write.bind(process.stdout))(`${JSON.stringify(value, null, 2)}\n`);
}

export async function runCapsuleCli(
  argv: readonly string[],
  io: CapsuleCliIo = {},
): Promise<number> {
  const [command, ...args] = argv;
  try {
    switch (command) {
      case "help":
      case "--help":
      case "-h":
      case undefined:
        (io.stdout ?? process.stdout.write.bind(process.stdout))(HELP);
        return 0;
      case "validate": {
        const [root, ...extra] = args;
        if (root === undefined || extra.length > 0)
          throw new Error("validate requires <capsule-root>");
        const capsule = await loadCapsule(root);
        output(io, {
          capsule_id: capsule.manifest.capsule_id,
          version: capsule.manifest.version,
          status: "valid",
          claims: capsule.domain.claims.length,
          requirements: capsule.requirements.length,
          evaluators: capsule.evaluators.length,
          cases: capsule.cases.length,
        });
        return 0;
      }
      case "confirm": {
        const [root, claimId, ownerId, ...extra] = args;
        if (
          root === undefined ||
          claimId === undefined ||
          ownerId === undefined ||
          extra.length > 0
        ) {
          throw new Error("confirm requires <capsule-root> <claim-id> <owner-id>");
        }
        const claim = await confirmCapsuleClaim({ root, claimId, ownerId });
        output(io, { claim_id: claim.claim_id, status: claim.status, owner_id: ownerId });
        return 0;
      }
      case "release": {
        const [root, ...extra] = args;
        if (root === undefined || extra.length > 0)
          throw new Error("release requires <capsule-root>");
        const released = await releaseCapsule(root);
        output(io, {
          capsule_id: released.release.capsule_id,
          release_sha256: released.sha256,
          ref: released.ref,
        });
        return 0;
      }
      case "run": {
        const [root, requirementId, evaluatorRef, candidateId, ...extra] = args;
        if (
          root === undefined ||
          requirementId === undefined ||
          evaluatorRef === undefined ||
          candidateId === undefined ||
          extra.length > 0
        ) {
          throw new Error(
            "run requires <capsule-root> <requirement-id> <evaluator-id>@<version> <candidate-id>",
          );
        }
        const capsule = await loadCapsule(root);
        const release = await releaseCapsule(root);
        const result = await evaluateCandidate({
          capsule,
          release,
          evaluatorRef,
          requirementId,
          candidateId,
          persist: true,
        });
        output(io, { ref: result.ref, sha256: result.sha256, run: result.run });
        return result.run.measurement_validity === "invalid" ? 2 : 0;
      }
      case "calibrate": {
        const [root, evaluatorRef, ...extra] = args;
        if (root === undefined || evaluatorRef === undefined || extra.length > 0) {
          throw new Error("calibrate requires <capsule-root> <evaluator-id>@<version>");
        }
        const capsule = await loadCapsule(root);
        const release = await releaseCapsule(root);
        const report = await calibrateEvaluator({ capsule, release, evaluatorRef });
        output(io, report);
        return report.qualified ? 0 : 3;
      }
      case "compare": {
        const [root, requirementId, leftEvaluatorRef, rightEvaluatorRef, ...extra] = args;
        if (
          root === undefined ||
          requirementId === undefined ||
          leftEvaluatorRef === undefined ||
          rightEvaluatorRef === undefined ||
          extra.length > 0
        ) {
          throw new Error(
            "compare requires <capsule-root> <requirement-id> <left-evaluator> <right-evaluator>",
          );
        }
        const capsule = await loadCapsule(root);
        const release = await releaseCapsule(root);
        output(
          io,
          await compareEvaluators({
            capsule,
            release,
            requirementId,
            leftEvaluatorRef,
            rightEvaluatorRef,
          }),
        );
        return 0;
      }
      case "replay": {
        const [root, runRef, ...extra] = args;
        if (root === undefined || runRef === undefined || extra.length > 0) {
          throw new Error("replay requires <capsule-root> <run-ref>");
        }
        const run = await replayEvaluationRun(root, runRef);
        await readCapsuleRelease(root, `.eval/releases/${run.capsule_release_sha256}.json`);
        output(io, run);
        return 0;
      }
      default:
        throw new Error(`unknown Capsule command: ${command}`);
    }
  } catch (error) {
    const message =
      error instanceof CapsuleError
        ? `${error.code}: ${error.message}`
        : error instanceof Error
          ? error.message
          : "Capsule command failed";
    (io.stderr ?? process.stderr.write.bind(process.stderr))(`${message}\n`);
    return 1;
  }
}
