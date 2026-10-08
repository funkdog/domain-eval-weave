import { exportJanitorConsumerKit } from "./lib/janitor-consumer-kit.mjs";

if (process.argv.length !== 3)
  throw new Error("usage: export-janitor-consumer-kit <prepared-task-root>");
console.log(JSON.stringify(await exportJanitorConsumerKit(process.argv[2]), null, 2));
