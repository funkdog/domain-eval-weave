import {
  ensurePhase2InstanceLayout,
  ensurePhase3AuthorLayout,
  ensurePhase3cJudgeLayout,
} from "../src/instance.js";

if (process.env.CI !== "true") {
  throw new Error("legacy CI runtime initialization is allowed only on an ephemeral CI runner");
}

await ensurePhase2InstanceLayout();
await ensurePhase3AuthorLayout();
await ensurePhase3cJudgeLayout();
