import { readFile } from "node:fs/promises";

import {
  freezeRecoveryEvaluation,
  gradeRecoveryDecisions,
  persistRecoveryArtifact,
  replayRecoveryArtifact,
} from "../packages/weave/src/evaluator/recovery-decision.ts";

const [command, inputPath, outputRoot, ...extra] = process.argv.slice(2);
if (
  extra.length ||
  !inputPath ||
  (command === "grade" ? !outputRoot : command !== "replay" || outputRoot)
) {
  throw new Error(
    "Usage: node --import tsx scripts/evaluate-killbill-recovery.mjs grade <submission.json> <runtime-dir> | replay <run.json>",
  );
}
const input = JSON.parse(await readFile(inputPath, "utf8"));
if (command === "replay") {
  console.log(JSON.stringify(replayRecoveryArtifact(input), null, 2));
} else {
  const artifact = gradeRecoveryDecisions(await freezeRecoveryEvaluation(), input);
  const path = await persistRecoveryArtifact(artifact, outputRoot);
  console.log(
    JSON.stringify({ path, run_digest: artifact.run_digest, result: artifact.result }, null, 2),
  );
}
