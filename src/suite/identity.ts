import type { TaskEntry } from "../contracts/phase2.js";
import {
  parseTaskPackIdentity,
  type TaskPack,
  type TaskPackIdentity,
} from "../task-pack/loader.js";

export function phase2TaskPackIdentity(task: TaskEntry, legacy: TaskPack): TaskPackIdentity {
  return parseTaskPackIdentity({
    schema_version: 1,
    pack: {
      ...legacy,
      base_tree_sha256: task.effective_base_sha256,
      oracle_version: task.oracle.version,
    },
    public_task_sha256: task.public_task_sha256,
    oracle_runner_sha256: task.oracle.runner_sha256,
  });
}
