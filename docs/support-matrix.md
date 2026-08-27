---
feature_ids: [F192, F266, F267]
topics: [dsh, eval-lab, capsule, platforms, sandbox, support]
doc_kind: guide
created: 2026-08-26
description: "Phase 4B platform and package support matrix."
---

# Support matrix

| Surface | macOS | Linux | Windows |
| --- | --- | --- | --- |
| Capsule validate/init/doctor/show/replay | Supported | Supported | Contract-only |
| Candidate command runner | `sandbox-exec` | `bubblewrap` | Unsupported |
| Offline calibration/compare | Supported | Supported when bubblewrap is installed | Unsupported |
| DSH adapter | Optional compatibility | Optional compatibility | Unsupported |

The runner never falls back to an unsandboxed process. Missing sandbox binaries produce
`CAPSULE_SANDBOX_UNAVAILABLE` before Candidate execution. Linux uses a new user/mount/network namespace,
read-only Candidate bind and writable scratch bind. macOS denies network and explicitly hides Capsule truth,
labels, releases, calibrations and Runs.

The Developer Preview workflow targets Node 24 on current GitHub-hosted macOS and Ubuntu runners. macOS runs
the complete historical regression plus the public package journey. Ubuntu runs the runner-neutral Capsule,
Evaluator, adapter, package and clean-room suites against a real bubblewrap installation; macOS-only legacy
`sandbox-exec` tests are not projected onto Linux. Windows support is not a Phase 4B commitment.
