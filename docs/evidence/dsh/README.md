---
feature_ids: [F192, F266, F267]
topics: [dsh, primary-evidence, plugin, profile, session, sandbox]
doc_kind: evidence-index
created: 2026-08-17
description: "DSH Eval Lab assignment 内置的一手 DSH 兼容性证据索引。"
---

# DSH primary evidence bundle

本目录让隔离实现 Agent 在不访问 sibling repository 的前提下读取本任务依赖的 DSH 一手证据。它只证明当前
DSH compatibility surface，不是第三份产品真相源；产品与实现要求仍由两份 canonical plan 决定。

## Provenance

- Upstream repository: `deepseek-ai/deepseek-harness`
- Fixed public source commit: `47f943859bef60e4160492346772ded9b24f765a`
- Source license: MIT；archive 根包含 upstream `LICENSE`
- Published deployment target: `@deepseek-ai/dsh@0.1.0-rc.6`
- Known gap: public source tree reports rc.5 and npm rc.6 has no public `gitHead` mapping。源码只证明结构；实际 rc.6
  exports、profile composition、dump-config 与 runtime behavior 必须由 contract tests / Gate 0 重新验证。

Archive: [`dsh-primary-evidence.tar`](./dsh-primary-evidence.tar)

SHA-256: `f027c416b8848585a96678d118eaae72e306bcd42ba35966c8e4c91362d4ff19`

## Included primary files

| Concern | Archive members |
|---|---|
| DSH home resolution | `packages/util/home-paths/src/index.ts` |
| Profile/bundle installation and composition | `apps/cli/reference/README.md`, `apps/cli/src/plugin.ts`, `apps/cli/src/profile-boot.ts`, `packages/boot/app-boot/README.md`, `packages/boot/app-boot/src/profile.ts` |
| App arguments and bounded exit | `apps/cli/src/args.ts`, `packages/boot/cmdline/README.md`, `packages/boot/app-boot/src/index.ts` |
| Fresh headless Session carrier | `packages/bundle/headless/README.md` |
| Session persistence / JSONL | `docs/subsystems/persistence.md`, `packages/session/session-persistence/README.md`, `packages/session/session-persistence-jsonl/README.md` |
| Goal evidence | `packages/goal/goal/src/domain.ts` |
| Tool pipeline and sandbox boundary | `packages/core/tools/README.md`, `docs/subsystems/tools.md`, `docs/subsystems/sandbox.md` |

## Required use

实现前至少核对：

1. `resolveDshHome` 的 precedence 是 explicit configured path → inherited `DSH_HOME` → `~/.dsh`；
2. profile 在 app plugin mount 之前从 `$DSH_HOME/profiles/<name>` 解析；
3. external bundle 通过 package manifest `dsh.bundle.patch` 加入 profile composition；
4. app plugin 能从 immutable `ctx.cmdlineArgs` 读取 inner argv，并通过 launcher-owned `ctx.appExit` 有界退出；
5. headless bundle 创建 fresh persisted Agent、等待 quiescence、flush Session 后退出；
6. rc.6 的实际 package exports 与上述结构假设必须在本产品 contract tests 中重新证明。

可以用 `tar -tf` 查看成员、用 `tar -xOf <archive> <member>` 只读单个文件。不要从本 evidence index 跳转到
assignment snapshot 外的本机路径。
