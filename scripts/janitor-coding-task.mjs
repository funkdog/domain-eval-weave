import {
  evaluateJanitorSubmission,
  materializeJanitorTask,
  replayJanitorRun,
  runJanitorWorkspaceCommand,
  submitJanitorSource,
} from "./lib/janitor-coding-task.mjs";

const [command, path, argument] = process.argv.slice(2);
let result;
if (command === "materialize") result = await materializeJanitorTask(path);
else if (command === "submit") result = await submitJanitorSource(path);
else if (command === "evaluate") result = await evaluateJanitorSubmission(path, argument);
else if (command === "replay") result = await replayJanitorRun(path);
else if (command === "workspace-exec") result = await runJanitorWorkspaceCommand(path, argument);
else
  throw new Error(
    "expected materialize <template> | submit <task-root> | evaluate <task-root> <submission-digest> | replay <run.json> | workspace-exec <task-root> <command>",
  );
console.log(JSON.stringify(result, null, 2));
