# 0.3.2-rc.14

- 提供动态上下文锁定的新任务图版本，包含执行期文件锁接口。前端打包时在导入、导出和模块之间保留语句边界。

# 0.3.2-rc.4

- 本次配对重新签发，发布清单记录对应的签名提交和同一槽位的动态上下文修订。
- 单元工作流 v2，Linux 与 WSL，工作流兼容周期 1。全新版本基数从 rc.0 重新编号。
- 本包与官方 Timeline 不兼容。包内新增离线 HTML 运行图谱、逐角色上下文、工具名单和联动指南。

# 0.3.1-rc.62

- 支持分组与分层终审、终点门控、暂停与恢复，并在会话中展示工作进度。

# 0.3.1-rc.42

- Generic located validation feedback and syntax normalization; host-only readArtifactIdentity export. Standalone task-graph behavior and the 16 MiB default artifact policy remain unchanged.
- Keep published version history below unchanged; this local work has not been published.

# 0.3.1-rc.42

- npm 包、Bundle 名称和 GitHub 仓库更名为 `dsh-better-task-grapth`。

# 0.3.1-rc.32 — DSH compatibility line

- Pin this build to its listed DSH releases and pair it with the other plugin on RC slot 2.
- Use the native Session plugin record API.

# 0.3.0-rc.11 — independent base and generic extension ports (2026-11-13)

- Restore the 0.2.3 standalone five-tool guidance and work protocol; restore the 16 MiB artifact default.
- Move joint revision prompts, reports and native role execution to the dynamic-context plugin. Retain generic structural revision validation.
- Add session-policy, CAS-store factory and durable graph-presence interfaces; no reverse dependency on dynamic context.
- Preserve committed V4 history; refuse to auto-commit legacy staged revisions without their original extension.

# 0.3.0-rc.10 — precise evidence navigation and scoped audit context (2026-11-12)

- Index source fields relative to parsed fact text. Invalid pointers report the missing segment and valid children; report-coverage failures identify missing, extra and duplicated change paths.
- Include fixed runtime semantics and only affected task states/dispositions in scoped audit input. Removing an unsatisfied dependency or invalid inheritance is distinguished from deleting historical records.
- Represent repeated large context nodes once in an exact content-addressed catalog. Before/after diffs and affected closures retain explicit references; source content, source checksums and the stored validated diff are preserved.
- Expose artifactCurrentIdentity separately from strict artifactProof so report-mode consumers can distinguish historical acceptance from current file observations, retaining path, symlink and change-during-read checks.

# 0.3.0-rc.9 — scoped modification reports (2026-11-12)

- Linked `report-scoped-v1` revision requires one explanation and verifiable original-source citation per effective change, including meaningful task-order changes.
- Expose `revision-report` for deterministic diffs, report/source validation and scoped audit assembly. Reject missing, extra or duplicate explanations and fabricated/unresolvable evidence before the audit.
- Audit receives the modification report, actual changed content, cited source fields and affected context closures. Existing graph/permission/history/commit validation remains in force; legacy standalone contexts keep their existing protocol.
