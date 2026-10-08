import { executeDshCodingRun, prepareDshCodingRun } from "./lib/dsh-coding-harness.mjs";

const [command, ...args] = process.argv.slice(2);
let result;
if (command === "prepare" && args.length === 3) {
  result = await prepareDshCodingRun({
    parentRoot: args[0],
    dependencyRoot: args[1],
    jdkHome: args[2],
  });
} else if ((command === "preflight" || command === "live") && args.length === 1) {
  result = await executeDshCodingRun(args[0], command);
} else
  throw new Error(
    "Internal CLI: prepare <runtime-parent> <dependency-dir> <jdk-home> | preflight <launch.json> | live <launch.json>",
  );
console.log(JSON.stringify(result, null, 2));
