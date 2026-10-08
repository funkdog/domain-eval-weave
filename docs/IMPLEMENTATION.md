---
feature_ids: []
topics: [implementation, developer-preview, capsule, packages, compatibility]
doc_kind: implementation-status
created: 2026-08-31
version: 0.1.0-alpha.0
status: current
description: "The current implemented boundary of the DomainEval Weave Developer Preview and its gap to the Domain-First product direction."
---

# DomainEval Weave Implementation

## Current status

The repository is a public **Developer Preview**. Its public packages remain private and the uninvolved
human clean-room gate is pending. The machine-readable status is
[`open-source-status.json`](../.github/open-source-status.json).

This document describes what the current tree implements. It does not make future architecture appear
shipped.

## Package ownership

| Package | Current responsibility |
| --- | --- |
| `@domaineval/weave` | Capsule contracts, authoring, release, readiness, Evaluator, Harness, CLI and canonical JSON |
| `@domaineval/dsh-adapter` | Optional DSH Session, observation and TDD-mechanism projection |
| `dsh-eval-lab` | Private legacy DSH compatibility, historical replay and research runtime |

The workspace root is a private orchestrator. Public package tarballs do not depend on the private legacy
package or repository paths at runtime.

## Implemented asset model

The current public unit is a Capsule containing six public contract families:

```text
Capsule Manifest
Domain Contract
Requirement Delta
Evaluator Package
Calibration Case
Evaluation Run
```

The current flow is:

```text
Sources
  → Claims
  → Requirements
  → Gold / equivalent / mutant cases
  → calibrated Evaluator
  → Candidate Run
  → artifact-only replay
```

`domain-eval init` creates a truth-empty draft. `doctor`, `show`, `validate`, `calibrate` and `compare`
operate locally and do not require DSH, OAuth credentials or model calls.

## Implemented guarantees

- content-addressed immutable releases and Runs;
- exact-byte artifact collision protection;
- deterministic canonical JSON;
- Claim provenance and explicit current status;
- Gold, behaviorally equivalent and mutant calibration cases;
- fail-closed Candidate execution through supported sandboxes;
- separation of Candidate inputs from trusted evaluation assets;
- artifact-only replay without rerunning the Candidate;
- isolated public package builds and packed-consumer verification;
- optional DSH adapter without making DSH part of the public core;
- macOS and Ubuntu public CI;
- Apache-2.0 code/docs and CC0 repository-authored synthetic source boundary.

## Current contribution surface

The Developer Preview accepts engine changes and provenance-bound Capsule assets. Contributors currently:

1. initialize a Capsule;
2. add licensed sources and Claims;
3. bind Requirements;
4. add Gold, equivalent and mutant Candidates;
5. calibrate an exact Evaluator version;
6. persist and replay an accepted Run.

The current workflow is documented in [`CONTRIBUTING.md`](../CONTRIBUTING.md). Platform support is defined
in [`support-matrix.md`](support-matrix.md).

## Trust boundaries

- Candidate code cannot read Claims, cases, labels, release locks or stored Runs.
- Missing sandbox support is measurement invalidity, not permission to run unsandboxed.
- Schema validity does not make a Claim true.
- Domain authority review and Evaluator calibration are separate decisions.
- A single pair or Judge run cannot establish a general Harness uplift claim.
- Repository examples and tests use synthetic data only.

## Active compatibility and governance artifacts

Three documentation paths remain because current automated gates consume them:

- [`support-matrix.md`](support-matrix.md) — public platform and package support;
- [`commerce-experience-acceptance.md`](guides/commerce-experience-acceptance.md) — legacy Commerce
  compatibility acceptance;
- [license boundary synthesis](research/2026-08-27-open-source-license-boundary/codex-synthesis.md) — the
  approved public license provenance required by the governance gate.

They are current inputs, not a general historical documentation system.

## Gap to the product direction

The current Domain Contract remains a flat `domain_id` plus Claims. It does not give dotted IDs hierarchy
semantics and does not implement a domain ontology or taxonomy graph.

The Commerce reference pilot now implements M0 through M4 internally under `packages/weave/src/domain/`:

- a physical, provenance-bound source index and seven independently identified Domain Modules;
- exact Module Release pins, typed directional Mappings and a deterministic Landscape digest;
- compiled Concepts, Relations and Claims with independent kind, epistemic-state and observability axes;
- scoped implementation-maintainer, regulator, provider, product, finance, network and industry Source
  Authority validation;
- one explicit Concept split with provenance and downstream Mapping/Landscape impact reporting;
- bitemporal Claim selection and scope-relative, multidimensional Coverage;
- exact View, Product Contract, Projection and fail-closed Evaluation Closure compilation;
- five deterministic Grade Atoms with birth certificates, three disjoint visible validation cohorts,
  immutable validation Runs and an independent freeze/execution/unseal qualification protocol.

This compiler is deliberately absent from the package export map. It has no public JSON Schema or CLI
surface, and the current Capsule contracts remain unchanged.

The Kill Bill candidate under `packages/weave/examples/killbill-orchestration/` additionally exercises an
optional internal `model` section: described fields and ownership, states/transitions, ordered flows,
invariants and pinned human documents. Compilation preserves this section, document contents and Claim
statements, checks Concept/state/source references and document digests, and includes model/document pins
in the existing module digest. It does not execute flows or infer semantic truth from prose.
`node --import tsx scripts/verify-killbill-module.mjs` verifies this one-module candidate offline against
its lock and pinned upstream source blobs. This is not public API promotion or Provider qualification.

The following product-level capabilities remain designed but not implemented:

- a public Domain-First Schema, TypeScript export or CLI surface;
- publication/storage lifecycles for Domain Releases, Views and Product Contracts;
- supported-release governance and discovery beyond the bounded reference Landscape;
- generalized non-Commerce compilers and grader predicates.

The current Capsule/Evaluator runtime is a reusable execution foundation, not proof that the Domain-First
product already exists.

The internal [payment recovery decision example](../packages/weave/examples/payment-recovery-eval/README.md)
consumes the pinned Kill Bill candidate and explicitly selected task policy to grade five synthetic
decision opportunities. It retains evidence, separate safety/progress results and immutable artifact-only
replay. Its authored responses are development examples, not independent Agent observations or financial
outcome evidence. The bounded projection is hand-authored; it does not promote public Domain-First
contracts or qualify a grader.

A [Kill Bill Java status-conversion coding candidate](../packages/weave/examples/killbill-status-coding/README.md)
now has component-execution feasibility evidence derived from upstream issue #366: the pinned class and
an authored equivalent preserve the declared mappings, while an explicitly seeded historical regression
throws on null status. This is an isolated Java component probe, not a full-project build, an external
Agent Run, a completed Coding Capsule or independent qualification.

Its internal local workflow now separates a frozen task from later submitted Java source snapshots;
prepares a public workspace and a private control directory; runs sandboxed workspace commands;
compiles and observes immutable submissions; and persists self-contained, artifact-replayable results.
This does not attest external Agent inputs/configuration/budget or promote the public API. The original
probe and the submission path share the same component executor.

An internal DSH bridge now connects the official rc.6 boot/AgentLoop/headless components through exactly
three sandboxed workspace tools. One `gpt-5.6-sol / xhigh` Session produced actual Java source in 5 model
requests and 6 tool calls; the Agent turn completed in 45.860 seconds. The worker then retained process
liveness and reached its 300-second cap. This is a shutdown failure, not an observed coding failure.
A separate recovery receipt binds the original launch, raw Session, tool-event chain and exact model
write bytes to a frozen source submission. Its component evaluation is valid/pass for all 12 observations,
and artifact-only replay agrees. No second model call/run was launched to obtain that result.

The worker now flushes evidence/output, bounds disposal, persists a separate shutdown receipt and exits
explicitly. Three model-free shutdown regressions and the real DSH model-free integration check pass.
The first recovered episode remains `agent_completed_process_shutdown_timed_out / not_qualified`; its
original failure is never rewritten as unattended success.

A separately authorized second live run of revision `ebed4b0` now completes automatically without recovery:
fresh workspace and root Session, 7 model requests and 7 tool calls, Agent turn 76.064 seconds, worker
79.889 seconds with exit code 0 and no timeout, and a separate `disposed` shutdown receipt. The coordinator
automatically freezes the source and records a valid/pass Code Run covering all 12 method observations.
Post-run inspection verifies launch/Session/tool-event bindings, exact model-written source bytes and
artifact-only replay. The outer episode records observed local DSH provenance; the inner Code Run retains
its code-artifact-only scope. This is one successful automated integration episode, not independent
qualification, a second task or general coding ability. No extra model run or test suite was used for
the post-run inspection. The candidate README records both runs and exact evidence anchors.

The internal [Coding consumer guide](../packages/weave/examples/killbill-status-coding/CONSUMER.md)
now documents the existing DSH-independent local CLI, its public-workspace/private-control boundary,
source submission and separate Agent-provenance obligations. It does not add a new protocol or public API.
A second Harness has not executed the task. The locally discovered Claude Code binary receives SIGKILL
even for help, despite matching architecture and valid code signing; the cause remains undetermined.
As an alternative, Codex CLI 0.153.4 starts successfully for version/help with a fresh isolated CODEX_HOME
and is the next integration candidate. A model-free native-tool probe now drives the actual CLI with
8 scripted tool actions over 9 loopback-only synthetic Responses exchanges. Its 12 checks verify public
read/write and Java execution, private shell/patch/image denial, unchanged private canaries, cwd-change
containment, denied escalation and denied command networking. Launch/result digests and raw evidence are
retained under the isolated runtime; missing observations fail closed. Tool declarations remain visible
despite some disabled features, so this is a bounded native-permissions proof, not an exclusive tool
allowlist or a complete safety qualification. No MCP dependency or replacement Agent loop was added.
The existing Java task and grader remain unchanged. At that checkpoint, isolated operator authorization
and the actual Codex Coding adapter were pending; the probe itself makes no real model request or
authentication migration. The consumer guide records the exact evidence and subsequent authorization.

After the operator confirmed isolated login, an internal native Codex coordinator was added. It rebinds
the verified native permission profile to a fresh task workspace, freezes launch/adapter/CLI identity,
and validates native Session input, model, effective permissions and tool-result linkage before submitting
the stopped workspace source to the unchanged Java evaluator. Two targeted projection checks pass on the
retained model-free CLI trace, including rejection of wrong input, permission expansion and missing output.
Those projection checks alone were not a second-Harness consumption success.
The first managed launch was rejected before native spawn because nested filesystem-table insertion
order differed after canonical manifest storage. No invocation/process artifact or native Session was
created, hence no model request occurred. Argument construction now canonicalizes the complete config;
a targeted round-trip regression went red-to-green. The rejected launch remains unchanged with a
separate posthoc diagnostic; a fresh launch was prepared for the still-pending first model run.
A subsequent CLI process rejected the task's leading YAML `---` as an option (46 ms, exit 2, no Session
or model request). Both paths now share the canonical argv builder with an option terminator. The
model-free preflight sends the actual TASK.md through the persisted/reloaded launch and verifies its
exact delivery; all 13 checks pass, including the previous isolation checks. A focused leading-hyphen
regression went red-to-green. Both rejected launches remain intact and are not counted as model episodes.

The first actual native Codex Coding episode now succeeds automatically on revision `e473a69`: process
exit 0 after 129.391 seconds, no timeout/truncation; one fresh Session with 9 recorded model-response
usage records and 8 top-level tool calls. Its final source uses explicit null guards, distinct from the
DSH candidate, while the complete frozen task/grader object is identical. The unchanged evaluator reports
valid/pass for all 12 method observations and artifact-only replay agrees. Episode
`d6553b57f4203f596d35877cd959996cff1f32e54830c9975fe9aa7bd109f5c3` records native input/model/permission/
tool provenance and the submitted-source/Code Run links. A development-feature warning and auxiliary
Git/xcrun error remain in the original trajectory. Post-run verification added no model call or test suite.

This establishes two actual Harness runtimes consuming one unchanged task and grader through author-built
local adapters. It does not establish uninvolved-consumer usability, cross-host distribution, equivalent
Harness budgets, general coding ability or independent qualification. Results remain `not_qualified`;
no public API, domain Claim status or capability ranking is promoted.

The next [Janitor recovery task design](../packages/weave/examples/killbill-janitor-recovery/TASK-DESIGN.md)
has preliminary operator approval and [bounded feasibility evidence](../packages/weave/examples/killbill-janitor-recovery/FEASIBILITY.md).
The source-compiled recovery class and real state/DAO helpers execute with an in-memory DAO and a
controlled account-lock interleaving, using 24 pinned release artifacts (8,025,641 bytes). Four authored
variants produce five observations each: the reference and equivalent preserve both safety and progress;
the seeded stale-snapshot regression overwrites CAPTURE_SUCCESS with AUTH_SUCCESS; the no-recovery
variant fails normal progress. A missing PersistentBus dependency was an initial environment failure,
retained separately and resolved with the pinned queue artifact before the complete observations.
The retained-data assessment preserves per-case results and accepts these development gates.
This is the prefetched/on-the-fly entry only: Capture completion and count are controlled fixture setup,
not an executed Capture pipeline or SQL store, and getPaymentInfo is not exercised. It is not a full
payment-system or distributed-lock proof. A subsequent [local task preparation contract](../packages/weave/examples/killbill-janitor-recovery/CONTRACT.md)
now freezes the task/build/observation inputs and materializes separate public workspace and private
control assets. It excludes the source archive and removes the target class plus three nested classes
from a fresh payment JAR copy, preserving all 261 remaining entries and their decompressed content.
The 23 delivered binary JARs contain no target/observer entries. Reference and regression health checks
under these derived dependencies succeed, with the regression rejected only on the stale-state scenario.
The task digest is `6b5115da3541484581ff2a9b9fe5d38b569072684532447aebc7e41664645db8`.
The subsequent local Coding workflow now materializes that same task, captures protected-input-checked
source submissions, evaluates immutable snapshots and replays the case vector from raw stored output.
The baseline fails and an authored equivalent passes through this new submission path; post-submission
workspace mutation does not affect evaluation, and a rewritten stored verdict is rejected by replay.
Four targeted checks cover these bindings plus invalid observations and actual sandbox denial of private
control/repository reads, private writes and network access. The same-JVM observer is not anti-tamper proof.

The existing Codex coordinator now has an explicit Janitor branch. A task-bound model-free native CLI
preflight passes all 13 gates, including compilation of the actual Janitor baseline and denial of private
task.json access; four existing native-transcript checks pass against the retained trajectory. No model
request is made by these checks. Under the operator's continuous-progression authorization, a fresh live
launch was prepared with the existing gpt-5.6-sol/xhigh profile, permissions and 300-second bound.
Its [first actual Janitor episode](../packages/weave/examples/killbill-janitor-recovery/RESULT.md) now completes:
the native process exits 0 after 110.389 seconds, without timeout/truncation; one new Session records
8 model-response usage entries and 7 top-level tool calls. The Agent removes the stale pre-lock read and
restores the existing under-lock refresh/eligibility path; the complete source equals the pinned upstream
reference. All 27 protected public inputs remain unchanged. The unchanged task, grader and execution
implementation yield valid/pass in all five scenarios, and artifact replay recomputes the same vector.
Episode `122cc757854152c0cfa38369d0ad670936016afc30e29aba585ad97d3f787c23` binds actual native input,
permissions, tool outputs, source submission and Code Run. A Git/xcrun development-command error and
the evaluator's SLF4J warning are retained. Post-run inspection uses no additional model/Java run or
test suite. This is one known-history, local component repair, not independent consumer usability,
unseen generalization or qualification. Original preparation receipts and old task/Domain Claims are
unchanged; no public API or additional dependency is introduced. Exact anchors and limits are in RESULT.md
and CONTRACT.md; qualification remains not_qualified.

A [local Janitor consumer kit](../packages/weave/examples/killbill-janitor-recovery/CONSUMER.md) now packages
the source closure, frozen seed and derived binary dependencies with an integrity-checked Node 24 entry.
It requires no original repository, npm install, authentication or author Session. In a copied directory,
doctor/prepare/submit/evaluate/replay succeeds on the broken baseline with the expected fail vector.
Trusted coordinator filesystem permissions deny original repository/template/export reads; Candidate code
retains the unchanged macOS StrictProcessRunner. Node child-process allowance is explicit, not an
adversarial coordinator sandbox. The initial attempt to nest Seatbelt failed closed and is retained.
The kit preserves the task/grader and binds its own state subtree; original repository defaults remain.
The [rehearsal report](../packages/weave/examples/killbill-janitor-recovery/CONSUMPTION-RESULT.md) records
66 protected payload files (15,760,029 bytes), manifest digest, successful relocation and drift rejection.
This is same-host, fixed-JDK author rehearsal only: independent-consumer usability, cross-host support,
public distribution and qualification remain unproven. No additional model call or dependency was used.

The next [fresh-context Agent consumer trial](../packages/weave/examples/killbill-janitor-recovery/CONSUMER-TRIAL.md)
has a bounded local control-plane bridge for read_guide and the kit's fixed doctor/prepare/submit/evaluate/
replay commands. It deliberately omits shell and arbitrary path access, limits instance/evaluation counts,
and retains the Candidate OS sandbox. This author-supplied adapter is not a public API or independent
consumer implementation. Backend checks pass and the shared native process/Session recorder is factored
for the new role, but native model-free preflight is blocked: MCP calls require approval while the current
policy is never. No real consumer-model request occurred and no tool-policy bypass was applied. Explicit
tool-scope authorization and a successful native preflight are required before live consumption. The
operator subsequently authorized exactly these two tools for one bounded trial. Launch-local enabled_tools
and per-tool approval_mode=approve now express that grant while server defaults stay prompt, global
approval_policy stays never and filesystem/network restrictions remain. Two model-free diagnostic issues
(a shadowed process binding and unnecessary OpenSSL config loading in a file probe) were corrected without
expanding permissions; their failed evidence remains. The final y8KFYY native preflight passes all ten
checks and live launch 7a5e4fac43b9dded815ececff37b4948c4c0fa2e839ddb500aa686240810992b was prepared.
The [single fresh-context consumer result](../packages/weave/examples/killbill-janitor-recovery/CONSUMER-FEEDBACK.md)
is now observed: native exit 0 after 90.082 seconds, 7 top-level calls (tool discovery plus 6 broker calls),
8 model-response usage entries, and no additional author messages. The unchanged baseline is submitted,
evaluated as valid/fail only for concurrent_capture, and replayed identically; all 66 kit inputs remain
unchanged. Episode e144661db869c62715afe0098f7e43696e25f75d5932c94d982e9d3c8a28d6d8 binds the native
Session, exact authorized tools, broker event chain and Code Run.

The consumer also reported a confirmed handoff omission: README asks for an independently delivered
expected kit digest, but the initial consumer input did not include it. Control-plane integrity checks
do not replace consumer-side comparison or source authentication. The recorded consumer_completed=true
only covers the frozen eight command/artifact observations, not every README requirement. A separate
[delivery receipt](../packages/weave/examples/killbill-janitor-recovery/DELIVERY-RECEIPT.md) is now supplied
for future handoffs without changing the old kit or result; its use has not been retested. No extra model,
Java execution or test suite was used in this result audit. The adapter remains author-supplied, human
consumers remain unobserved, and qualification stays not_qualified.

### Historical static-presentation preparation — consumer comparison not run

The next [Janitor money acceptance-maintenance task](../packages/weave/examples/killbill-janitor-money-acceptance/PLAN.md)
now has [model-free preparation evidence](../packages/weave/examples/killbill-janitor-money-acceptance/PREPARATION.md).
The existing five-case observer always supplies explicit Plugin amount
and currency, while the pinned Janitor/DAO helper implements path-dependent defaults and independent field
selection. The proposed consumer maintains executable acceptance code, rather than repairing the same
payment class again. It compares equal-information prose with the existing domain representation and
retains zero/negative outcomes as legitimate results. The prepared arms share 13 identical files and retain
all 1,640 Module nodes in the prose coverage inventory; independent semantic-equivalence/readability review
is still pending. Four authored Java variants each execute the five original and seven new scenarios.
The reference and parenthesized equivalent pass all twelve; incorrect requested-money defaults pass the
original five but fail three new amount cases or two new currency cases. Raw process observations and
frozen-input bindings agree. This is author-side component calibration, not a consumer trial or a qualified
meta-evaluator. Independent calibration, evaluator-author submission/execution and launch remain pending.
No consumer model ran; old tasks, the domain release, public contracts and qualification states are unchanged.

### Prior-knowledge consumption v2 — verifier-author intake preparation

The operator subsequently clarified that an existing domain package should reduce the background supplied
with a new requirement. The [current plan](../packages/weave/examples/killbill-janitor-money-acceptance/PLAN.md)
therefore retires the Markdown/YAML comparison and compares identical source material, baseline acceptance,
dependencies and a concise task with/without the previously authored domain package. The
[information ledger](../packages/weave/examples/killbill-janitor-money-acceptance/INFORMATION-LEDGER.md)
separates common inputs, pre-task knowledge, post-task answer assets and unresolved new policy.

An internal model-free preparation/admission/evaluation/replay entry now accepts `JanitorProbe.java`
as verifier source. It compiles captured source against control-side component variants, uses a trusted
completion frame to distinguish normal return, AssertionError and invalid execution, and retains a
sample vector rather than trusting a submitted score. Prepared arms have 34 identical protected inputs;
the knowledge arm additionally receives the original Module and five human-model documents. Every extra
file is checked against Git revision `9ba1708`, predating task selection. The old rendering-helper scope
fix is retained separately and is not the treatment. Model-free runtime calibration is now recorded below;
independent content/runtime qualification remains pending. No consumer model/launch command is implemented by this entry, and all
receipts remain `not_qualified`. No public API, dependencies, old tasks or old results are changed.
Non-author review confirmed the input delta but found that the four-sample matrix would accept a verifier
that drops all legacy checks. The revised control set therefore adds the already frozen stale-snapshot
component and the symmetric money-only verifier negative control. Machine outputs now report sample fit
and file presence separately, leaving scope/content review pending rather than declaring delivery complete.

The first model-free v2 calibration (`q1IsCY/calibration.AoGugJ/report.json`) stopped at the isolation
probe before running any verifier matrix. The private read was denied, but this macOS/JDK combination
reported `FileSystemException: Operation not permitted` rather than the probe's expected
`AccessDeniedException`; the write probe was not reached. The narrow correction recognizes these explicit
permission-denial forms only, without granting access or swallowing unrelated I/O failures. A newly frozen
trial `Zz6x2C` binds the corrected implementation; the original failure remains intact.

The corrected model-free calibration at `320f2a7` completed in 19 seconds. Report
`Zz6x2C/calibration.KDrhPn/report.json`, digest
`3937211971bc83f30831a9f26076be7f44ede09660b317b9ab4c0033ae9a046b`, records five verifier sources
against five component variants with no invalid execution. Complete reference tests fit all selected
samples; old-only tests miss both money defects, money-only tests miss the stale snapshot, always-accept
misses three defects, and always-reject rejects both correct variants. Projecting the money-only
observations onto the former four samples confirms that matrix would have missed the legacy omission.
Private reads/writes are denied; protected-input mutation and symlink admission are rejected. The old-only
submission is captured, executed and artifact-replayed identically; both future consumer workspaces remain
unchanged. Raw process frames, digests and replay were checked without further Java/model execution.
This is authored tool calibration, not an independent domain certification or a knowledge-benefit result.
Native consumer launch, its isolation checks and the paired trial remain unimplemented/unrun; frozen
receipts still say `launch_ready=false`, `independent_review=pending` and `not_qualified` as applicable.

### Native verifier-author pair entry — preparation before the live attempt

The internal `scripts/janitor-knowledge-run.mjs` entry now prepares one frozen pair, launches one explicitly
authorized arm at a time, and replays existing episodes. It reuses the pinned Codex process/Session recorder
and the already calibrated verifier submission/evaluation path. Each arm gets the same task and native
configuration, except for its isolated workspace; each has one attempt and a 300-second cap. Failed native
attempts retain attributable process/Session evidence and source capture without automatic retries. The
extended model-free native probe uses a separate copy of public verifier inputs and checks control/peer
workspace denial; it does not rerun the verifier calibration matrix. The [runbook](../packages/weave/examples/killbill-janitor-money-acceptance/RUN.md)
defines the exact artifacts, budget and caller-authorization boundary. At `082e37c`, two focused
configuration/early-refusal checks pass. The real-CLI synthetic preflight `codex-tool-probe.nFjRTE` passes
all 13 gates, including the exact verifier prompt, private/control/peer reads denied and public verifier
compilation. Four existing native-transcript checks pass on this new retained Session without replaying
Java or making model calls. Pair `82289798da71dfe39ec1ef43ccb921617c0f73e4cca4b38a65bc06a473fbd7ab`
is frozen under `janitor-knowledge-trial.Zz6x2C/control/knowledge-pair.json`; both manifests have identical
prompts/configuration apart from workspace paths, and neither has an attempt record. Independent review
and operator confirmation of the bounded pair remain pending; no consumer model ran. Failure capture
and single-attempt behavior are implemented, not claimed as already tested on a real failed model run.

The operator then explicitly withdrew cross-review and authorized this bounded pair in message
`0001789061886456-000354-4b36bb6e`. The raw-source arm has been launched without changing the frozen
inputs, permissions, model or budget. Its actual result is pending; the knowledge arm is not started until
the first arm's runtime/measurement evidence is valid. This waiver is not review approval or qualification.

The first live command was rejected before native CLI/model execution because the new entry incorrectly
assumed an unpadded 13-digit timestamp in the operator message ID. Both run roots still contained only
launch files; there was no attempt, invocation, process or episode. The correction treats the ID as an
opaque bounded audit reference and adds a red-to-green regression using the actual padded ID. Unstarted
pair revisions append immutable manifests while retaining the original per-arm run roots/attempt locks;
they cannot create a second attempt. A sequential live-pair command stops on invalid runtime/measurement
and never retries. The corrected native preflight `codex-tool-probe.R5HD1I` passes all 13 gates; its
actual Session and tool outputs were checked. The revised pair digest
`b0f93efe73698d5f740efbebba0ff051d45be02ad20c1114cac2e63b3e77d6c7` retains the original run roots,
inputs and budgets. Its live-pair command has now been launched under the same explicit operator
authorization; the observed result is recorded below. No business calibration or evaluated-model attempt was repeated.

### Paired trial result — stopped, environment-confounded

The [recorded result](../packages/weave/examples/killbill-janitor-money-acceptance/RESULT.md) contains one
real raw-source attempt, terminated at 300,014 ms (SIGKILL, timedOut=true, no output-limit event). The
knowledge arm never started. Episode f02fb7a7d90bcc2da856ec6ff9539221a43f83986d3b1c1278569f114a31d344
retains 15 paired tool calls/results, a partial native Session, changed source and no INFORMATION.md;
evaluation remains null. Artifact-only replay preserves that incomplete outcome without more Java/model
execution. Both protected input sets remain unchanged.

This attempt exposed a delivery mismatch: the control-side evaluator installs mock-maker-subclass,
but the public workspace/run command does not. Its first baseline execution fails with missing
net.bytebuddy.agent.ByteBuddyAgent. The native preflight compiled JanitorProbe but executed only the
simple Probe, so JAVA_READY did not establish public baseline runtime readiness. The Agent rewrote
Mockito mocks as Java proxies and added three missing-money cases; its later development execution
prints all eight cases and END. That is partial development evidence, not control-side mutant acceptance.
The timeout mixes business work with environment repair and cannot show domain-package advantage or
disadvantage. The paired comparison is incomplete, not a zero/negative benefit estimate. Repairing the
common public runtime configuration and exercising the actual baseline is recommended but not done in
this result-receipt step. No model retries or further code evaluation were performed; not_qualified remains.

### Public baseline runtime repair

Following operator continuation `0001789091868508-000402-d5564e74`, both public arms now receive the same
mock-maker-subclass resource as the control evaluator, with resources included in the published runtime
classpath. The native preflight executes the actual public build/run commands and checks all five baseline
scenario records and completion, and pair preparation requires explicit public-baseline execution evidence.
New frozen trial `janitor-knowledge-trial.5uXHdK` differs from the failed trial only in the shared environment
file and added Mockito resource: baseline source, component samples, reference verifier, wrapper, dependencies
and knowledge treatment are unchanged. At `0e63af0`, the existing focused calibration passes and native
preflight `codex-tool-probe.5eROt9` executes all five actual public baseline scenarios with completion:
public_baseline_execution_observed=true. Original tool output and native Session were inspected; no Mockito
initialization failure remains on that path. The repaired pair
`10eced5424c713a8fbd161fa088968567b1348cd4a87d1ab7ce6d87a1d7139d0` is now launched with the same model,
permissions and one 300-second attempt per arm under the operator continuation. Results remain pending.
The previous failed trial remains unaltered and cannot be treated as a comparable baseline for the repaired round.

### Repaired round outcome — budget-limited, no paired comparison

The repaired raw-source arm also reaches the 300-second limit, but this time its actual public baseline
execution completes all five cases without the previous Mockito error. The retained Session has 11 paired
tool calls/results, all reads or baseline compilation/execution; captured source is unchanged, INFORMATION.md
is absent and evaluation remains null. Episode
`992532b165d6d2c647e4c77902efb9164758c479bd262763fcd096bff13c645b` is replayed without further
Java/model execution; the knowledge arm has no attempt. The [repaired-round report](../packages/weave/examples/killbill-janitor-money-acceptance/RESULT-REPAIRED.md)
separates this budget-limited non-delivery from the prior environment-confounded attempt.

Two design limitations now need explicit interpretation: the five-minute budget was not stated as a
deadline in the shared task, and the pair controller treats any incomplete native turn as grounds to stop
the other arm. Timeout can be a bounded non-delivery observation, not necessarily invalid measurement.
No stop-policy amendment, B launch or budget increase was made in this receipt step. A future amendment
must remain visible and must not turn the missing comparison into a knowledge-benefit verdict.

### Completion-led amendment

Operator `0001789093433167-000429-11b9616a` explicitly prioritizes direction/value validation over the
temporary time cap. New verifier-author launches use wall_ms=null and no experiment timer; existing
finite-budget callers retain their behavior. Two model-free subprocess checks establish natural completion
for null and timeout enforcement for a finite budget. Operator/platform cancellation still terminates the
child group and records interruption. The existing output guard and the managed-command platform's
one-hour ceiling remain infrastructure boundaries, not capability grading criteria.

New trial `janitor-knowledge-trial.7sSm8O` will use two fresh contexts with identical repaired public inputs,
model and treatment difference. Previous capped attempts remain separate. At freeze no new model had run.
Same-path calibration and native public-baseline validation now pass at `82303bd`; pair
`c9e1c0e9d42fe5e7515260aa9d188dd946e11ee11f70a0cc4ba073976414361b` binds the two null-budget launches.
The author's hourly managed-command quota is exhausted, so execution was handed to Maine Coon in task
`0001789094209883-000445-0870f006` via structured message `0001789094304624-000447-12c68f90`.
This is execution delegation, not cross-review. Actual native execution has not yet been confirmed;
the author will consume the returned artifacts for value analysis.

Operator `0001789095818445-000483-f15bbf77` subsequently requires execution by the author and withdraws
delegation. Both slots still contain only launches; pins, arguments and null budgets match. The author
notified the former successor not to start, then attempted the exact A command through managed execution.
The platform returned 429 maxHoldsPerWindow; no command/model started. The frozen pair remains ready,
execution responsibility is the author, and the remaining blocker is scheduler availability rather than
experiment preparation or approval. Do not bypass the quota or restart setup on the next continuation.

## Internal Commerce Reference Landscape

### Objective

The repository contains one substantial, synthetic Commerce Reference Landscape that exercises the
Domain-First architecture end to end without replacing or weakening the current Capsule/Evaluator path.

The increment is successful when the same exact Domain Releases can produce multiple contextual Views,
different Product Contracts, more than one Eval Projection, one complete Closure, one honest Closure
refusal and one independently qualified hard grader. The compiler and hardened qualification protocol are
implemented; a runtime-verified external-Curator receipt is pending. The reference assets are permanent
examples and contract fixtures, not throwaway scaffolding. Their semantic scenarios and counterexamples
are stable; their internal serialization may evolve until M5 decides the public contract.

### Implementation boundary

- Keep `@domaineval/weave` as the only public core package; do not add a domain package or remote Registry.
- Add the reference assets under `packages/weave/examples/commerce-landscape/`.
- Build the initial compiler under `packages/weave/src/domain/` and keep it internal until the full
  reference acceptance passes.
- Use internal TypeScript/Zod contracts during the reference-model cycle. Do not export new JSON Schemas,
  package subpaths or CLI commands before the promotion milestone.
- Reuse canonical JSON, immutable artifact writing, release locks and artifact-only replay already owned by
  Weave.
- Enforce the one-way dependency chain `domain → view → contract → projection → closure`. No module in
  that chain may import Evaluator or Harness implementation code. Evaluators and Graders may consume an
  immutable Closure but cannot be imported by it. A contract test guards this import direction across all
  milestones, not only the initial Landscape compiler.
- Preserve the existing Capsule public contracts and current examples unchanged during the pilot.
- Use only synthetic data. Do not add network services, production adapters, graph databases, RDF/OWL
  runtime requirements, automatic authority ranking or LLM truth confirmation.
- Do not change the private legacy package unless a compatibility test proves a necessary boundary update.

### Reference composition

The fixture set includes independently owned model contexts for:

```text
commerce.orders
payments.refunds
promotions.coupons
finance.ledger
```

It also includes:

- a `payments.disputes` bridge that keeps `Chargeback` distinct from merchant refund;
- one provider-specific refund representation mapped to the community refund model without identity
  collapse;
- regulator-, provider- and product-scoped Source Authority annotations;
- two Product Contracts over one contextual View with different refund deadlines and coupon commitments;
- confirmed, contested, unknown and unobservable Claims;
- one revision/split/supersede lineage with downstream impact;
- a paid, unshipped order whose value is cash 80 plus coupon entitlement 20.

### Milestone M0 — reference corpus and red contracts

**Status:** implemented for the Commerce reference corpus. M1–M4 contracts are green.

Create the reference source assets and contract tests before compiler implementation.

Tests must initially fail for the absence of Domain-First support and cover:

- stable Module, Concept, Claim, Mapping and Release identity;
- exact release and digest pins;
- typed, directional mappings and competing representations;
- versioned Scope Declaration;
- valid-time and recorded-time fixtures, including one late source;
- independent Claim kind, epistemic state and observability combinations, including confirmed but
  unobservable and contested but observable counterexamples;
- scoped Source Authority counterexamples proving that implementation-maintainer, provider, product and
  regulator authority cannot substitute for one another;
- two Product Contracts over one View;
- explicit unknown, contested and unobservable knowledge;
- the five planned Grade Atoms and one observation-gap Closure refusal.

M0 does not introduce a public runtime API. Its output is the executable acceptance corpus for the next
milestones.

### Milestone M1 — Domain Release and Landscape compiler

**Status:** implemented as an internal compiler. Public promotion remains deferred to M5.

Implement internal parsing and compilation for Domain Modules, Releases, Mappings and Landscapes.

The compiler must:

- validate scope, ownership, stable IDs and reference integrity;
- reject floating release references, identity collisions and unresolved required mappings;
- preserve separate identities for community and provider models;
- produce deterministic canonical bytes and a content digest;
- retain provenance and predecessor/revision relationships;
- report affected mappings and Landscapes for split or supersede changes;
- represent Claim kind, epistemic state and observability as independent axes without deriving one from
  another;
- validate Source Authority assertions as scoped, evidenced annotations and reject an authority substitution
  such as using a provider contract to confirm a regulatory duty or a product owner to confirm a general
  legal rule;
- represent exact software code, API, configuration, maintainer documentation and maintainer tests as
  `implementation_artifact` evidence whose `implementation_maintainer` authority is limited to that
  implementation and exact applicability scope.

M1 is the sole implementation owner for Architecture acceptance #4 and #5. Later milestones consume these
Claim and authority semantics without redefining or weakening them.

The compiled Landscape is immutable input to later milestones.

### Milestone M2 — bitemporal replay and Coverage

**Status:** implemented internally for the reference Landscape.

Add valid-time and recorded-time selection plus derived, scope-relative Coverage.

Acceptance requires:

- reconstructing the rule applicable to a historical Episode;
- reconstructing the knowledge state available before a late source was recorded;
- distinguishing `missing`, `unknown`, `contested`, `unobservable` and `out_of_scope`;
- proving that an Eval Projection cannot improve Domain Coverage by excluding an in-scope Concept that is
  difficult to observe;
- keeping Domain maturity separate from Eval readiness.

Coverage is a report derived from exact inputs. It is never stored as an author-entered score.

### Milestone M3 — View, Product Contract, Projection and Closure

**Status:** implemented internally with one complete Closure, an unavailable-observation refusal and a
missing-binding refusal.

Compile an exact Landscape into contextual Views, then apply optional Product Contracts and task-specific
Eval Projections.

The compiler must preserve unresolved conflicts and explicit exclusions. Evaluation Closure must bind:

- exact Claim revisions and applicability;
- Episode and cross-system identity;
- Observation Contracts and completeness assumptions;
- business time, observation time and lateness;
- missing-evidence, absence and composition semantics.

It must produce both:

1. a complete Closure for the fully observable reference path; and
2. a structured refusal when coupon restoration or another required in-scope fact is not observable.

The refusal cannot silently narrow the evaluation question.

### Milestone M4 — Grade Atoms and artifact-only replay

**Status:** the deterministic Atoms, visible development/calibration/validation evidence, immutable Run
replay and independent qualification protocol are implemented internally. Third-party review found that
the second Curator Run bound message-reference strings without requiring a runtime verifier and excluded
only visible case IDs rather than observation vectors. That Run is superseded and cannot support
`qualified`.

The protocol now requires a verifier capability at freeze and admission. The verifier must resolve the
Cat Café operator-assignment and Curator-acceptance messages for the exact candidate and emits a
content-addressed attestation carried through freeze, execution, unseal and Run. Candidate identity also
binds observation digests for every visible cohort and every retired holdout so renaming a known case
cannot make it independent. A new candidate and a third unseen holdout are required.

Compile deterministic Grade Atoms for:

```text
cash amount and original tender
cash refund timeliness
coupon entitlement restoration
economic effect exactly-once
ledger reconciliation
```

Each Atom targets one independently falsifiable Claim over one eligible Episode and implements its utility,
consumer, validity bounds, estimator, calibration plan and repeatability contract.

Results preserve the atomic vector and use:

```text
pass / fail / not_applicable / insufficient_evidence / indeterminate
```

Exactly-once is judged by economic effect, not provider call count. Missing records produce `fail` only
when the Observation Contract proves the relevant channel and window complete.

The final Run must replay artifact-only from exact Domain Releases, Landscape, View, Product Contract,
Projection, Closure, grader and observation artifacts.

M4 executes one visible development/calibration/validation path without treating its known labels as
qualification evidence:

```text
development cases
  → calibration cases with Gold, equivalent and targeted mutant outcomes
  → public validation cases and reference expectations
```

Development cases may shape predicates but cannot satisfy admission. Calibration and public validation
evidence record expected and observed per-Atom outcomes, false-accept/false-reject cases and repeatability,
but can produce only `validated`.

Independent qualification is a separate digest chain:

```text
candidate/Closure/grader freeze
  → independent Curator freezes label-free holdout cases
  → frozen grader executes and persists predictions
  → Curator unseals labels after execution
  → admission Run compares the bound predictions and expectations
```

A hard Grader becomes `qualified` only when this independent chain is complete, targeted mutants are
rejected, behaviorally equivalent outcomes are accepted and artifact-only replay reproduces the same
evidence. Author-visible reference labels can never issue qualification.

### Milestone M5 — public promotion decision

Only after M0–M4 and all twelve architecture design tests pass may the project decide the public contract.

M5 reviews the proven internal model and either:

- promotes the necessary schemas, TypeScript exports and CLI surface; or
- reports which object boundaries remain unstable and keeps the compiler internal.

Promotion must not expose unused ontology machinery. It requires packed-consumer verification, current
Capsule regression, public type/lint/test/build gates, deterministic replay and a documentation update that
removes any remaining “designed but not implemented” claims now made true.

### Acceptance ownership

Each Architecture design test has one implementation owner:

| Architecture acceptance | Implementation owner |
| --- | --- |
| 1. independently released Modules and typed mappings | M1 |
| 2. competing provider representation without identity collapse | M1 |
| 3. two Product Contracts over one View | M3 |
| 4. confirmed, contested, unknown and unobservable Claims | M1 |
| 5. scoped regulator/provider/product Source Authority | M1 |
| 6. revision, split or supersede with impact reporting | M1 |
| 7. multiple Eval Projections from one Release set | M3 |
| 8. successful Closure and honest refusal | M3 |
| 9. five Grade Atoms | M4 |
| 10. exact artifact-only replay | M4 |
| 11. Scope/Coverage anti-truncation | M2 |
| 12. valid-time/recorded-time replay | M2 |

### TDD and review order

For every milestone:

```text
reference example and red contract test
  → minimum coherent implementation
  → negative and adversarial cases
  → deterministic rebuild/replay
  → focused independent review
```

Do not combine discovery, calibration and qualification into one fixture cohort. Do not start the next
milestone while the current milestone has unresolved blocking findings.

## Source of truth

Current behavior is governed by executable artifacts rather than historical phase plans:

- package manifests and exported source under `packages/`;
- JSON Schemas under `packages/weave/schemas/`;
- public acceptance tests under `tests/acceptance/`;
- legacy compatibility tests under `legacy/dsh-eval-lab/tests/`;
- [PRODUCT.md](PRODUCT.md) for current product direction;
- [ARCHITECTURE.md](ARCHITECTURE.md) for the proposed Domain-First architecture.

When this file disagrees with executable contracts, the implementation and tests are authoritative for
current behavior; the mismatch must then be corrected here.
