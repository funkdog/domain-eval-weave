import {
  evaluateSubmission,
  prepareCodingTask,
  replayCodingRun,
  runWorkspaceCommand,
  submitCodingSource,
} from "./lib/killbill-coding-task.mjs";

const [command, ...args] = process.argv.slice(2);
let result;
if (command === "prepare" && args.length === 3) {
  result = await prepareCodingTask({
    parentRoot: args[0],
    dependencyRoot: args[1],
    jdkHome: args[2],
  });
} else if (command === "workspace-exec" && args.length === 2) {
  result = await runWorkspaceCommand(args[0], args[1]);
} else if (command === "submit" && args.length === 1) {
  result = await submitCodingSource(args[0]);
} else if (command === "evaluate" && args.length === 2) {
  result = await evaluateSubmission(args[0], args[1]);
} else if (command === "replay" && args.length === 1) {
  result = await replayCodingRun(args[0]);
} else {
  throw new Error(
    "Internal local CLI: prepare <runtime-parent> <dependency-dir> <jdk-home> | workspace-exec <task-root> <shell-command> | submit <task-root> | evaluate <task-root> <submission-digest> | replay <run.json>",
  );
}
console.log(JSON.stringify(result, null, 2));
