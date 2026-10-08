import {
  prepareKnowledgePair,
  replayKnowledgeEpisode,
  runKnowledgeArm,
} from "./lib/janitor-knowledge-harness.mjs";

const [mode, ...args] = process.argv.slice(2);
const counts = { prepare: 4, live: 3, "live-pair": 2, replay: 1 };
if (!(mode in counts) || args.length !== counts[mode])
  throw new Error(
    "prepare <trial> <calibration-report> <native-preflight> <isolated-auth-home> | live <pair> <arm> <operator-message-id> | live-pair <pair> <operator-message-id> | replay <episode>",
  );
async function livePair(pair, operatorMessageId) {
  const results = [];
  for (const arm of ["raw_sources", "prior_knowledge"]) {
    const result = await runKnowledgeArm(pair, arm, operatorMessageId);
    results.push({ arm, ...result });
    console.log(JSON.stringify({ arm, ...result }));
    if (
      !result.native_complete ||
      result.artifact_error ||
      result.evaluation?.measurement_validity !== "valid"
    )
      break;
  }
  const complete =
    results.length === 2 &&
    results.every(
      (r) =>
        r.native_complete && !r.artifact_error && r.evaluation?.measurement_validity === "valid",
    );
  if (!complete) process.exitCode = 1;
  return { complete, results, qualification: "not_qualified" };
}
const result = await {
  prepare: prepareKnowledgePair,
  live: runKnowledgeArm,
  "live-pair": livePair,
  replay: replayKnowledgeEpisode,
}[mode](...args);
console.log(JSON.stringify(result));
if (mode === "live" && (!result.native_complete || result.artifact_error)) process.exitCode = 1;
