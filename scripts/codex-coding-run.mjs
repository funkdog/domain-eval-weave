import { prepareCodexCodingRun, runCodexCoding } from "./lib/codex-coding-harness.mjs";

const [command, ...args] = process.argv.slice(2);
let result;
if (command === "prepare" && args.length === 4)
  result = await prepareCodexCodingRun({
    preflightRoot: args[0],
    authHome: args[1],
    dependencyRoot: args[2],
    jdkHome: args[3],
  });
else if (command === "prepare-janitor" && args.length === 3)
  result = await prepareCodexCodingRun({
    preflightRoot: args[0],
    authHome: args[1],
    janitorTemplate: args[2],
  });
else if (command === "live" && args.length === 1) result = await runCodexCoding(args[0]);
else
  throw new Error(
    "Internal CLI: prepare <preflight-root> <isolated-auth-home> <dependency-root> <jdk-home> | prepare-janitor <preflight-root> <isolated-auth-home> <frozen-task-root> | live <launch.json>",
  );
console.log(JSON.stringify(result, null, 2));
