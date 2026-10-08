import {
  calibrateVerifier,
  evaluateVerifier,
  prepareVerifierTrial,
  replayVerifier,
  submitVerifier,
} from "./lib/janitor-verifier-task.mjs";

const [mode, ...args] = process.argv.slice(2);
const counts = { prepare: 2, submit: 2, evaluate: 2, replay: 1, calibrate: 1 };
if (!(mode in counts) || args.length !== counts[mode])
  throw new Error(
    "prepare <old-task> <author-probe> | submit <trial> <arm> | evaluate <trial> <digest> | replay <run> | calibrate <trial>; no model launch command",
  );
const fn = {
  prepare: prepareVerifierTrial,
  submit: submitVerifier,
  evaluate: evaluateVerifier,
  replay: replayVerifier,
  calibrate: calibrateVerifier,
}[mode];
const result = await fn(...args);
console.log(JSON.stringify(result));
if (mode === "calibrate" && !result.passed) process.exitCode = 1;
