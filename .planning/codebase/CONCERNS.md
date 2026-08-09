---
last_mapped_commit: c8816b4cdd04e6992cc7974d588e96fef89c3df1
---

# Codebase Concerns

**Analysis Date:** 2026-08-08

## Tech Debt

**Stale committed config backup:**
- Issue: `config/engines.yaml.bak` is a stale 3-line backup of `engines.yaml` (which is now 46 lines with Pi/LM Studio config). Committed to the repo and never referenced by code.
- Files: `config/engines.yaml.bak`
- Impact: Confusing for maintainers; suggests hand-editing of live config files rather than using the config editor.
- Fix approach: Delete the `.bak` file; rely on git history for rollback.

**Dead empty file:**
- Issue: `src/bun/engine/execution/model-resolver-simplified.ts` is 0 bytes — a leftover from the "model-resolver-simplified" refactor that was never removed. The active resolver is `src/bun/engine/execution/model-resolver.ts`.
- Files: `src/bun/engine/execution/model-resolver-simplified.ts`
- Impact: Dead weight; may confuse tooling/import scans.
- Fix approach: Delete the file.

**Machine-specific config committed to git:**
- Issue: `config/engines.yaml` is committed and contains machine-local details (e.g. `providers.lmstudio.base_url: http://localhost:1234/v1`, model IDs like `lmstudio/qwen3.6-27b`). Meanwhile `config/workspace.yaml` and `config/providers.yaml` are gitignored precisely because they hold "local paths and API keys" (see `.gitignore` lines 23-31). `engines.yaml` can also hold API keys (the sample documents `api_key: cur_xxx` for Cursor), so the ignore policy is inconsistent.
- Files: `config/engines.yaml`, `config/engines.yaml.sample`, `.gitignore`
- Impact: Risk of committing API keys to the repo; users cloning the repo inherit another machine's engines.
- Fix approach: Gitignore `config/engines.yaml`, keep only `engines.yaml.sample` committed.

**Config module is a god-file:**
- Issue: `src/bun/config/index.ts` (947 lines) mixes workspace registry discovery, YAML load/merge, defaults, workflow seeding, persistence (`patchWorkspaceYaml`), engine config parsing, and global config reading. Module-level mutable singletons (`_config`, `_configsByKey`, `_configError`, `_workspaceRegistry`, `_seededWorkflowDirs`) plus an `AsyncLocalStorage` context (`configContext`).
- Files: `src/bun/config/index.ts`
- Impact: Hard to reason about cache invalidation; `loadConfig()` is called twice at startup (`src/bun/index.ts:99` and `src/bun/index.ts:200`).
- Fix approach: Split persistence/seeding/registry into separate modules; consolidate the double `loadConfig()` at boot.

**RPC contract file is a monolith:**
- Issue: `src/shared/rpc-types.ts` (1168 lines) is the single source of truth for ~109 API methods plus push events, task/conversation/workspace types. Every API change touches this one file (see `src/bun/index.ts:251-277` where 20 handler modules are flattened into one `allHandlers` record).
- Files: `src/shared/rpc-types.ts`
- Impact: Merge conflicts; large blast radius for type changes; no per-domain boundaries.
- Fix approach: Split types per domain (`rpc-tasks.ts`, `rpc-conversation.ts`, …) re-exported from an index, and/or generate from the handler modules.

**Duplicate numeric migration prefixes:**
- Issue: Migration filenames reuse numbers: `007_line_comments.ts` + `007_shell_command_approval.ts`, `008_hunk_decisions_sent.ts` + `008_task_todos.ts`, `016_execution_checkpoints.ts` + `016_task_position.ts`, `018_git_base_sha.ts` + `018_stream_events.ts`. The runner (`src/bun/db/migrations/runner.ts:43-67`) validates by full ID so this is safe, but the numbers are misleading and the sort-order/ID-order validation is a trap for new migrations.
- Files: `src/bun/db/migrations/007_line_comments.ts`, `src/bun/db/migrations/016_task_position.ts`, etc. (60 migrations total)
- Impact: Easy to introduce an out-of-order ID; server refuses to boot (by design, but abrupt).
- Fix approach: Renumber sequentially; keep the validator as a guard.

**Frontend Monaco components are untyped:**
- Issue: Monaco editor code is written against `any` throughout: `src/mainview/components/InlineReviewEditor.vue` (~30 `any` casts, view zones/décos/`editor` all `any`), `src/mainview/components/FileEditorOverlay.vue:87`, `src/mainview/components/WorkflowEditorOverlay.vue:80`, `src/mainview/components/EnginesEditorOverlay.vue:87`, plus `(self as any).MonacoEnvironment` at `InlineReviewEditor.vue:29`.
- Files: `src/mainview/components/InlineReviewEditor.vue`, `src/mainview/components/FileEditorOverlay.vue`, `src/mainview/components/WorkflowEditorOverlay.vue`, `src/mainview/components/EnginesEditorOverlay.vue`
- Impact: No type safety on the most complex frontend component (~964 lines with view-zone diff rendering); refactors there are risky.
- Fix approach: Introduce a thin typed wrapper for the Monaco APIs used, or use `monaco-editor`'s own types with targeted casts.

**Stale planning doc at repo root:**
- Issue: `api-improvements.md` is an old proposal tracker (retry/T2-T8 proposals). Parts landed (`src/bun/ai/retry.ts` exists); the doc is not maintained.
- Files: `api-improvements.md`
- Impact: Misleading status for the remaining proposals (T3-T8).
- Fix approach: Move to `notes/` or delete; track remaining items in the planning system.

**Import style inconsistency:**
- Issue: `src/bun/engine/execution/model-resolver.ts` imports without the `.ts` extension (`../../db/row-types`, `../../db/workspace-repository`) while the rest of the codebase uses explicit `.ts` extensions (enforced by the Bun runtime resolution).
- Files: `src/bun/engine/execution/model-resolver.ts`
- Impact: Inconsistent with convention; can silently break under different resolvers.
- Fix approach: Add `.ts` extensions.

## Known Bugs

**PTY session map grows unbounded:**
- Issue: `src/bun/launch/pty.ts` keeps every created session in the module-level `sessions` Map. When a session exits naturally, `markExited` fires but the entry is never removed from the Map — only `killPtySession` (`launch.kill` or shutdown) deletes. Every `launch.shell` / `launch.run` (terminal mode) that exits on its own leaks a session entry forever.
- Files: `src/bun/launch/pty.ts:19-36, 91-103`
- Trigger: Open a terminal session, exit the shell, repeat.
- Impact: Slow unbounded memory growth in long-lived servers; stale sessions stay reachable by `/ws/pty/<id>`.
- Workaround: None automated; restart the server.
- Fix approach: Delete from `sessions` in `markExited` (after notifying listeners) or add a TTL sweep.

**Frontend WebSocket has no heartbeat:**
- Issue: `src/mainview/rpc.ts:75-115` reconnects on close but there is no ping/keepalive or staleness detection. The server (`src/bun/index.ts:284`) sets `idleTimeout: 30` on HTTP, and a half-open TCP connection can keep the client thinking it is connected indefinitely (no `onerror` fires for silent drops).
- Files: `src/mainview/rpc.ts`, `src/bun/index.ts:284`
- Trigger: Laptop sleep / network blip that silently kills the socket.
- Impact: UI shows stale state until the next user action; no automatic recovery for silent disconnects.
- Fix approach: Client-side ping timer; treat a missed pong as closed (the reconnect backoff already exists).

**Engine failure modes are engine-specific and patched reactively:**
- Issue: Recent git history shows a repeated pattern of post-release fixes for the same fragile components: Cursor engine HTTP/2 session stalls (`b4b6b71b`), stale active run recovery (`6858d83a`), permanent tool-registry crippling from undisposed shadow compact sessions (`ff111a1e`); Pi engine no-output regression (`72ffbcd2`), Pi shell timeout (`0880a2b1`), 524 during compaction/summarization and undici timeout wiring (`245a008c`, `4aef4ccd`, `d4415e5f`); Claude subagent permission failures after SDK upgrades (`71cc2081`).
- Files: `src/bun/engine/cursor/engine.ts`, `src/bun/engine/cursor/recovery.ts`, `src/bun/engine/cursor/inprocess-adapter.ts`, `src/bun/engine/pi/engine.ts`, `src/bun/engine/pi/harness/*`, `src/bun/engine/claude/adapter.ts`
- Impact: These are the highest-churn files in the repo; each SDK bump (claude-agent-sdk, pi-coding-agent, @cursor/sdk) has historically required follow-up fixes.
- Fix approach: Treat SDK upgrades as first-class phases with migration tests; keep the recovery/hardening modules (`recovery.ts`, timeout config) covered by tests before upgrading SDKs.

**Cancellation races with zombie cleanup:**
- Issue: `src/bun/engine/orchestrator.ts:185-190` documents a race: `registry.cancelAll(executionId)` may overwrite status to `failed` (zombie cleanup path) before the orchestrator's own `cancelled` update, requiring a pre-fetch of the row. The ordering dependency is subtle and fragile.
- Files: `src/bun/engine/orchestrator.ts:182-217`
- Impact: Intermittent cancelled-vs-failed status flips under concurrent cancel + engine timeout.
- Fix approach: Move status finalization into a single owner (e.g. the StreamProcessor consume loop) instead of two writers.

**Silent catch blocks:**
- Issue: 148 empty/silent `catch { /* ... */ }` blocks in `src/bun/` (excluding tests) — e.g. `src/bun/launch/pty.ts:30,33,76,99`, `src/bun/git/diff-utils.ts:162,170,253`, `src/bun/handlers/lsp.ts:75`, `src/bun/handlers/tasks.ts:280`, `src/bun/config/index.ts:933`.
- Files: see list above (representative)
- Impact: Failures surface only as missing behavior (empty diffs, no LSP config, dead listeners), hard to diagnose in production logs.
- Fix approach: Route unexpected branches through the file logger (`src/bun/server/file-logger.ts`) or at least a warning; keep empty catches only for genuinely benign races.

## Security Considerations

**Unauthenticated localhost API = local RCE vector:**
- Risk: The server binds `127.0.0.1` (`src/bun/index.ts:282`) with no auth and no Origin/CSRF protection on any route. The `/api/launch.run` handler (`src/bun/handlers/launch.ts:31-81`) executes an arbitrary client-supplied `command` string via the shell (`getShellArgs(params.command)`), and `/ws/pty/<sessionId>` (`src/bun/index.ts:295-300`, `src/bun/server/websocket.ts`) streams interactive shell I/O with only a UUID for a secret.
- Files: `src/bun/index.ts:281-344`, `src/bun/handlers/launch.ts:31-88`, `src/bun/server/websocket.ts`, `src/mainview/rpc.ts:24-28`
- Current mitigation: Loopback binding only; PTY session IDs are UUIDs; browsers preflight `application/json` POSTs (but `text/plain` POST bodies bypass preflight and `req.json()` parses regardless of content-type, and WebSocket upgrades are not subject to CORS at all).
- Recommendations: Validate the `Origin` header on `/api/*` and `/ws` (only allow `http://127.0.0.1:<port>` / `http://localhost:<port>`), add a per-run token (like the debug server's random port) or local-user auth, and/or require confirmation for `launch.run` commands that are not in `railyin.yaml`.

**API key exposure to the frontend:**
- Risk: `workspace.getConfig` returns the resolved provider `apiKey` in the payload (`src/bun/handlers/workspace.ts:41` — `apiKey: legacyAi?.api_key ?? firstProvider?.api_key ?? ""`), consumed by `src/mainview/stores/workspace.ts:39` and `src/mainview/components/BoardDetailDialog.vue:123`. Combined with the unauthenticated API, any local process/page can harvest the key.
- Files: `src/bun/handlers/workspace.ts:41`, `src/bun/handlers/config.ts`, `src/shared/rpc-types.ts:510`
- Current mitigation: Loopback binding; key is used for local provider calls.
- Recommendations: Return the key only if the frontend actually needs it (it does not appear to be rendered anywhere); otherwise strip it from `WorkspaceConfig` and read it server-side only.

**OAuth tokens stored in plaintext, possibly inside git repos:**
- Risk: MCP OAuth tokens + DCR client registrations are persisted as plain JSON in `mcp-tokens.json` — globally at `~/.railyn/mcp-tokens.json` and **per-project at `<projectPath>/.railyn/mcp-tokens.json`** (`src/bun/oauth/token-store.ts:30-35`). `.gitignore` does not cover `.railyn/` or `mcp-tokens.json`, so project-scoped token files can be accidentally committed.
- Files: `src/bun/oauth/token-store.ts`, `src/bun/mcp/config-loader.ts`, `.gitignore`
- Current mitigation: Tokens are scoped per server name; global path is outside repos.
- Recommendations: Add `.railyn/mcp-tokens.json` (and any `.railyn/` token artifacts) to the repo's `.gitignore` guidance; document the file as secrets-bearing; consider OS keychain for at-rest encryption.

**osascript/terminal launch string injection:**
- Risk: `src/bun/launch/launcher.ts:20,39` interpolate the launch `command` into an AppleScript string with only the cwd shell-escaped. A command containing `"` or `$()` breaks out of the intended quoting. Commands come from `railyin.yaml` (trusted-ish) but `launch.run` accepts arbitrary commands from the API (see above).
- Files: `src/bun/launch/launcher.ts:18-50`
- Current mitigation: Commands originate from config or the unauthenticated local API (i.e. no real mitigation).
- Recommendations: When fixing the auth gap, treat `launch.run` commands as high-risk; escape or argv-array-spawn instead of string interpolation.

**Static file serving has no traversal guard:**
- Risk: `src/bun/index.ts:331-340` joins `url.pathname` directly onto `DIST_DIR`. URL normalization in `new URL()` neutralizes plain `../`, and percent-encoded variants fail `exists()`, so the practical risk is low — but there is no explicit guard, and any future change to request handling could expose files outside `dist/`.
- Files: `src/bun/index.ts:331-340`
- Recommendations: Add an explicit containment check (`path.resolve(filePath).startsWith(path.resolve(DIST_DIR))`) before serving.

## Performance Bottlenecks

**Startup blocks up to 10s on shell env resolution:**
- Problem: `src/bun/index.ts:83` awaits `getResolvedShellEnv()` before migrations/server start. A slow `.zshrc` (nvm, pyenv, etc.) stalls the entire boot for up to 10s (configurable via `shell_env_timeout_ms`).
- Files: `src/bun/shell-env.ts:90-156, 182-244`, `src/bun/index.ts:83`
- Cause: `spawn(shell, ['-i','-l','-c', ...])` sources all shell init files serially.
- Improvement path: Kick off resolution in parallel with migrations/server boot (the env is only needed for tool subprocesses), or cache the resolved env on disk keyed by shell+mtime.

**Model listing fans out to every engine with 8s timeouts:**
- Problem: `listModels` calls every engine in parallel, each raced against an 8s timeout, with failures silently converted to `[]` (`src/bun/engine/orchestrator.ts:232-245`). A slow provider (e.g. LM Studio not running) delays the model picker UI and hides real errors.
- Files: `src/bun/engine/orchestrator.ts:221-245`
- Improvement path: Cache model lists per engine with TTL; surface per-engine errors to the UI instead of empty results.

**Per-token broadcast without persistence — designed, but watch DB load:**
- Note: `src/bun/engine/stream/stream-processor.ts:25-29` deliberately skips DB writes for `assistant.message_delta` / `assistant.reasoning_delta` / `content_block_delta` (comment: ~90% write-load reduction). This is intentional and good, but the `stream_events` and `conversation_messages` tables still receive every assembled chunk; long executions (multi-hour agent runs) produce large row counts.
- Files: `src/bun/engine/stream/stream-processor.ts:25-29, 105-120`
- Improvement path: None needed now; monitor `stream_events` growth — the retention job (`src/bun/jobs/retention-job.ts`, 87 lines) is the only cleanup.

## Fragile Areas

**Cursor engine (in-process SDK):**
- Files: `src/bun/engine/cursor/engine.ts`, `src/bun/engine/cursor/inprocess-adapter.ts`, `src/bun/engine/cursor/recovery.ts`
- Why fragile: Depends on `@cursor/sdk` HTTP/2 session behavior; has needed busy-agent recovery (`recovery.ts`, `PersistentBusyError`), stale-run recovery, and tool-registry eviction fixes in recent history.
- Safe modification: Keep the recovery/lifecycle paths covered by the tests under `src/bun/test/cursor/`; avoid changing agent warm-keep logic without re-running them.
- Test coverage: `src/bun/test/cursor/` suite plus `e2e/ui/cursor.spec.ts` exist; mutation thresholds are not enforced (Stryker `break: null` in `stryker.backend.json`).

**Pi engine (config churn):**
- Files: `src/bun/engine/pi/engine.ts`, `src/bun/config/index.ts` (Pi config validation), `src/bun/engine/pi/harness/*`
- Why fragile: Two breaking config migrations landed recently (`interleaved` → `thinkingFormat`; `sampling_presets` moved under `models.<id>`) plus timeout/dispose fixes. AGENTS.md documents both as "breaking".
- Safe modification: Always update `validatePiEngineConfig` in `src/bun/config/index.ts` alongside any SDK knob; run `src/bun/test/pi/**` before/after.
- Test coverage: `src/bun/test/pi/` suite exists (harness + fixtures).

**Two-layer conversation UI:**
- Files: `src/mainview/stores/conversation.ts` (448 lines) + `src/mainview/components/ConversationBody.vue` (644) + `src/mainview/components/ConversationInput.vue` (1131)
- Why fragile: Persisted `conversation_messages` must stay consistent with live WebSocket stream blocks; AGENTS.md explicitly warns "Changes must preserve both". `ConversationInput.vue` at 1131 lines is the largest component in the repo.
- Safe modification: Test with `bun test src/mainview/stores/conversation.test.ts` and `e2e/ui/stream-reactivity.spec.ts` / `conversation-stream-state.spec.ts`.
- Test coverage: Store-level unit tests exist; the giant components themselves are only covered via Playwright mocks (`e2e/ui/fixtures/mock-api.ts`).

**Board/task lifecycle coupling:**
- Files: `src/bun/handlers/tasks.ts` (504), `src/bun/workflow/transition-validator.ts`, `src/mainview/stores/task.ts` (511), `src/mainview/views/BoardView.vue` (969)
- Why fragile: `tasks.transition` enforces WIP limits (`transition-validator.ts:55-64`), triggers worktree setup / git context / execution — a single change ripples across handlers, DB state, and board UI.
- Safe modification: Cover with `src/bun/test/board-tool-executor.test.ts`, `column-config.test.ts`, and the Playwright board specs (`board-capacity.spec.ts`, `board-allowed-transitions.spec.ts`).

## Scaling Limits

**SQLite as the only store:**
- Current capacity: Single-process Bun server, `bun:sqlite` synchronous access (`.get`/`.all`/`.run` calls sprinkled through handlers and executors; e.g. `src/bun/db/board-queries.ts`), in-memory DB mode for dev.
- Limit: Writes from multiple concurrent engine executions contend on one connection; `stream_events`/`model_raw_messages` row volume grows with every token of every execution (mitigated only for the 3 high-frequency event types).
- Scaling path: Batch writes via the write-buffer pipeline (`src/bun/pipeline/write-buffer.ts`); consider WAL tuning and periodic `VACUUM`; multi-user/server deployments would require a real DB layer.

**PTY session concurrency:**
- Current capacity: PTY sessions are a module-level `Map` with 64KB scrollback cap each (`src/bun/launch/pty.ts:4`); no session count limit.
- Limit: Each session holds a spawned shell process; many long-lived sessions exhaust file descriptors/processes (and leak per the bug above).
- Scaling path: Enforce a max concurrent session count and auto-expire sessions after inactivity.

## Dependencies at Risk

**SDK-heavy engine layer:**
- `@anthropic-ai/claude-agent-sdk` (0.3.204, pinned): has broken subagent permissions across upgrades in the past (`71cc2081`).
- `@cursor/sdk` (^1.0.25): HTTP/2 stall and busy-agent issues required custom recovery code (`recovery.ts`).
- `@earendil-works/pi-coding-agent` (^0.80.3): frequent releases; each has required timeout/reasoning/config fixes (`d4415e5f`, `0880a2b1`, `245a008c`).
- `@opencode-ai/sdk` (^1.14.33): major-version churn risk.
- Impact: Any SDK bump can silently change streaming/tool/permission behavior across three engines.
- Migration plan: Pin exact versions (done for claude); add an upgrade checklist phase per SDK bump with engine regression tests before merging.

**Native addon double-path:**
- `better-sqlite3` is used only via test shims (`src/bun/test/shims/bun-sqlite.ts`) so Stryker/vitest can run under Node, while production uses `bun:sqlite`. Two SQLite drivers with slightly different behaviors must stay in sync for the mutation suite to be meaningful.
- Files: `src/bun/test/shims/bun-sqlite.ts`, `src/bun/test/shims/vitest-teardown.ts`, `src/bun/db/index.ts`
- Risk: Shims drift from production semantics (e.g. `lastInsertRowid`, upsert behavior).

## Missing Critical Features

**No authentication or session model for the local server:**
- Problem: The app assumes a single trusted local user. There is no origin validation, token, or user concept anywhere (`src/bun/index.ts:281-344`).
- Blocks: Running the server on a shared machine, LAN access, or any multi-user scenario; also blocks safe exposure of `launch.run`/PTY/`workspace.getConfig`.

**No config migration/versioning for user YAML:**
- Problem: Breaking changes to `workspace.yaml`/`engines.yaml` schema (like the two Pi config migrations) are handled by code validation + docs, with no versioned migration path or auto-upgrade. Users with stale configs get runtime errors or silent fallbacks (`loadConfig` warnings only).
- Files: `src/bun/config/index.ts` (validation), `config/engines.yaml.sample`
- Blocks: Smooth upgrades for existing installations.

## Test Coverage Gaps

**Frontend unit coverage is thin:**
- What's not tested: 17 test files for ~116 `src/mainview/` files; the largest components (`ConversationInput.vue` 1131 lines, `BoardView.vue` 969, `CodeReviewOverlay.vue` 964, `InlineReviewEditor.vue` 908, `SetupView.vue` 951) have no direct unit tests.
- Files: `src/mainview/components/*`, `src/mainview/views/*`
- Risk: UI regressions are only caught by Playwright specs that mock all backend traffic (`e2e/ui/fixtures/mock-api.ts`) — mismatches between mocks and the real API drift unnoticed.
- Priority: Medium

**No tests for the boot composition root:**
- What's not tested: `src/bun/index.ts` (385 lines — handler wiring, engine factory map, server fetch routing, config error broadcast) has no direct test; boot failures surface only via e2e.
- Files: `src/bun/index.ts`
- Risk: A broken handler registration or engine factory crash takes down the whole server.
- Priority: Medium

**Engine registry/cross-engine transfer paths:**
- What's not tested: Model resolution across engines (`resolveEngineForModel`, `src/bun/engine/engine-registry.ts`) and cross-engine context transfer edge cases; recent fix `c8816b4c` ("skip cross-engine transfer for same-type engines") touched this without a dedicated regression test file for the transfer path itself.
- Files: `src/bun/engine/engine-registry.ts`, `src/bun/conversation/cross-engine-context.ts`
- Risk: Task handoffs between engines degrade silently (model params, reasoning flags).
- Priority: Medium

**Mutation thresholds not enforced:**
- What's not tested: `stryker.backend.json` / `stryker.frontend.json` set `break: null` and `low: 60` / `high: 80` — CI runs the suite (`mutation.yml`) but never fails on low mutation scores.
- Files: `stryker.backend.json`, `stryker.frontend.json`, `.github/workflows/mutation.yml`
- Risk: Mutation testing becomes a reporting exercise rather than a quality gate.
- Priority: Low

**Experimental refinement harness is committed:**
- What's not tested: `refinement/` (scenario runner, LM Studio proxy, fixtures) is committed product-adjacent experimental code with its own test directory, separate from the main suites.
- Files: `refinement/runner.ts`, `refinement/engine-runner.ts`, `refinement/providers.ts`
- Risk: Drift from the real engine APIs; dead code weight.
- Priority: Low

---

*Concerns audit: 2026-08-08*
