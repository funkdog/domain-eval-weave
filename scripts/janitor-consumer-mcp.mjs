import { createInterface } from "node:readline";
import { consumerTools, createConsumerBroker } from "./lib/janitor-consumer-broker.mjs";

// Private, fixed-tool stdio transport. No network listener, sampling, shell, filesystem API or SDK install.
const [kitRoot, logRoot, kitDigest] = process.argv.slice(2);
const broker = await createConsumerBroker({ kitRoot, logRoot, kitDigest });
const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
let initialized = false,
  ready = false;
for await (const line of lines) {
  if (Buffer.byteLength(line) > 32768) {
    process.stderr.write("oversized MCP frame\n");
    process.exitCode = 1;
    break;
  }
  let request;
  try {
    request = JSON.parse(line);
  } catch {
    process.stdout.write(
      `${JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } })}\n`,
    );
    continue;
  }
  if (request.method === "notifications/initialized") {
    ready = initialized;
    continue;
  }
  if (!Object.hasOwn(request, "id")) continue;
  let response;
  if (request.jsonrpc !== "2.0") response = { error: { code: -32600, message: "Invalid request" } };
  else if (request.method === "initialize" && !initialized) {
    initialized = true;
    response = {
      result: {
        protocolVersion: "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "weave-local-consumer", version: "0.1.0" },
      },
    };
  } else if (request.method === "ping") response = { result: {} };
  else if (!ready) response = { error: { code: -32002, message: "Initialize first" } };
  else if (request.method === "tools/list") response = { result: { tools: consumerTools } };
  else if (request.method === "tools/call")
    response = {
      result: await broker.invoke(request.params?.name, request.params?.arguments ?? {}),
    };
  else response = { error: { code: -32601, message: "Method not found" } };
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: request.id, ...response })}\n`);
}
