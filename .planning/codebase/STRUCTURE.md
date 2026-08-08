---
last_mapped_commit: c8816b4cdd04e6992cc7974d588e96fef89c3df1
---
<!-- refreshed: 2026-08-08 -->
# Codebase Structure

**Analysis Date:** 2026-08-08

## Directory Layout

```
railyin-tree/
├── src/
│   ├── bun/               # Backend (Bun runtime: HTTP, WS, SQLite, engines)
│   ├── mainview/          # Frontend SPA (Vue 3 + Pinia + PrimeVue)
│   └── shared/            # Shared contract (RPC types, stream tree)
├── config/                # YAML config: engines.yaml, workspace.yaml.sample, workflows/
├── e2e/
│   ├── api/               # API smoke tests + server fixture
│   └── ui/                # Playwright UI specs (backend fully mocked)
├── scripts/               # Dev launcher, postinstall, backfill
├── openspec/              # OpenSpec specs + change proposals (specs/, changes/)
├── .github/prompts/       # .prompt.md files referenced as /prompt-name
├── extensions/railyin-ref # VS Code-style extension (separate npm project)
├── refinement/            # LLM refinement harness (analysis/runner/providers)
├── notes/                 # Dev notes (markdown)
├── reports/mutation/      # Stryker mutation test reports
├── test/                  # smoke.ts — smoke test entry
└── .railyin/              # Runtime data (system-prompts, mcp.json per project)
```

## Directory Purposes

**`src/bun/` — Backend:**
- Purpose: All server-side code; runs under the Bun runtime with `.ts` imports allowed (`allowImportingTsExtensions`).
- Contains: HTTP/WS server, RPC handlers, execution engines, SQLite layer, config loading, subsystems.
- Key files: `index.ts` (composition root / entry point — see Architecture), `shell-env.ts`, `workspace-context.ts`, `project-store.ts`, `context-usage.ts`, `logger.ts`.

**`src/bun/engine/` — Execution core:**
- Purpose: AI engine plugin system and the execution state machine.
- Contains:
  - `orchestrator.ts`, `engine-registry.ts`, `coordinator.ts`, `types.ts` — core contracts.
  - `execution/` — executors + param building: `transition-executor.ts`, `human-turn-executor.ts`, `retry-executor.ts`, `code-review-executor.ts`, `chat-executor.ts`, `execution-params-builder.ts`, `model-resolver.ts`, `working-directory-resolver.ts`, `prompt-assembly-service.ts`, `slash-command-resolver.ts`, `custom-prompt-injector.ts`, `execution-params-enricher.ts`, `system-prompt-assembler.ts`, `model-resolver-simplified.ts`.
  - `stream/` — `stream-processor.ts` (engine-event state machine), `raw-message-buffer.ts`.
  - Engine families: `pi/` (largest — SDK wrapper: `engine.ts`, `run-driver.ts`, `execution-controller.ts`, `session-manager.ts`, `compaction-coordinator.ts`, `model-config.ts`, `tools/`, `harness/`), `claude/`, `copilot/`, `cursor/`, `opencode/`.
  - `dialects/` — per-engine slash-command dialects + registry.
  - Support: `common-tools.ts`, `tool-display.ts`, `validate-tool-args.ts`, `qualified-model-id.ts`, `lease-registry.ts`, `card-tool-definitions.ts`, `decision-request-tool-definition.ts`, `lsp-tool-definitions.ts`, `mcp-discovery-tool-definitions.ts`, `workspace-tool-definitions.ts`, `git/` (git-diff-parser), `__tests__/`.
- Tests: `src/bun/test/` (integration/pi/server/cursor/shims/support) and co-located `*.test.ts` files (e.g. `src/bun/engine/cursor/*.test.ts`).

**`src/bun/handlers/` — RPC handlers:**
- Purpose: One module per domain, each exporting a factory `(deps) => Record<methodName, (params) => response>`; merged into `allHandlers` in `src/bun/index.ts:251-277`.
- Key files: `tasks.ts`, `boards.ts`, `workspace.ts`, `projects.ts`, `conversations.ts`, `chat-sessions.ts`, `engine.ts`, `models.ts`, `workflow.ts`, `mcp.ts`, `lsp.ts`, `launch.ts`, `code-server.ts`, `code-review.ts`, `todos.ts`, `decisions.ts`, `notes.ts`, `task-git.ts`, `config.ts`, `position-service.ts`.

**`src/bun/db/` — Persistence:**
- Purpose: SQLite (bun:sqlite, WAL). Singleton access via `getDb()`; typed row mappers (`mappers.ts`, `row-types.ts`); domain query helpers (`task-queries.ts`, `board-queries.ts`, `stream-events.ts`, `todos.ts`).
- Contains: `migrations/` (54 numbered migrations + `runner.ts` + `_utils.ts` — checksum-verified, see Architecture constraints), `repositories/` (per-domain repos: `model-settings-repository.ts`, `decision-repository.ts`, `note-repository.ts`, `shell-approval-repository.ts`, `conversation-injection-state-repository.ts`, `TaskGitContextRepository.ts`, `ITaskGitContextRepository.ts`), `seed.ts`, `workspace-repository.ts`, `task-repository.ts`.

**`src/bun/config/` — Configuration loading:**
- Purpose: YAML load/validate (`config/index.ts`, ~950 lines of types + validation), workflow seeding (`workflows.ts`), path resolution (`path-utils.ts`).
- Behavior: per-workspace configs under the data dir; global engines from `config/engines.yaml`; `runWithConfig` scopes config via AsyncLocalStorage.

**`src/bun/conversation/` — Conversation pipeline:**
- Purpose: message persistence (`messages.ts`), context estimation (`context.ts`, `context-estimator.ts`), streaming buffer (`conv-message-buffer.ts`), cross-engine context transfer (`cross-engine-context.ts`), prompt injection (`stage-instructions-injector.ts`, `decision-context-injector.ts`, `decision-submission.ts`), policy modules (`model-params-policy.ts`, `reasoning-mode-policy.ts`).

**`src/bun/workflow/` — Workflow semantics:**
- Purpose: column config lookup (`column-config.ts`), transition validation (`transition-validator.ts`), session memory (`session-memory.ts`), review logic (`review.ts`), tool surface (`tools.ts`, `tools/registry.ts`, `tools/board-tool-executor.ts`, `tools/lsp-tools.ts`).

**`src/bun/server/` — Transport/plumbing:**
- Purpose: WS handler (`websocket.ts`), fan-out (`broadcast-channel.ts`), stream event processing (`stream-processor.ts`), notifications (`notifications.ts`), file logging (`file-logger.ts`), graceful shutdown (`shutdown.ts`).

**`src/bun/mcp/` + `src/bun/oauth/` — MCP + OAuth:**
- Purpose: MCP client registries (global + per-project, `registry-pool.ts`, `registry.ts`, `client.ts`, `config-loader.ts`, `discovery-tools.ts`) and OAuth2.1/PKCE flow (`oauth/`: `token-exchange.ts`, `token-store.ts`, `pkce.ts`, `scope-resolution.ts`, `pending-flow-store.ts`, `discovery.ts`).

**`src/bun/git/` — Git/worktree:**
- Purpose: project resolution (`ProjectResolver.ts`, `IProjectResolver.ts`), repo manager (`GitRepositoryManager.ts`), worktree lifecycle (`WorktreeManager.ts`), diff helpers (`diff-utils.ts`).

**`src/bun/lsp/` — Language servers:**
- Purpose: manager (`manager.ts`), client (`client.ts`), registry (`registry.ts`), installer (`installer.ts`), detection (`detect.ts`), per-task registries (`task-registry.ts`), config writer (`config-writer.ts`), formatters (`formatters.ts`), apply-edits (`apply-edits.ts`).

**`src/bun/launch/` — External process launch:**
- Purpose: PTY sessions (`pty.ts`), terminal detection + macOS launcher (`terminal.ts`, `launcher.ts`), code-server integration (`code-server.ts`), launch config (`config.ts`).

**`src/bun/jobs/`:** `retention-job.ts` — periodic DB retention cleanup (started at boot, `src/bun/index.ts:240-242`).

**`src/bun/pipeline/`:** `write-buffer.ts` (batched DB writes), `stream-event-enricher.ts` (seq/blockId assignment) + tests.

**`src/bun/testing/`:** `mock-engine.ts` — scripted engine for dev/tests (`RAILYN_TEST_EXECUTION_ENGINE=mock`).

**`src/bun/utils/`:** platform helpers (`platform.ts`), diff (`diff.ts`), attachment routing (`attachment-routing.ts`, `resolve-file-attachments.ts`), browser open (`browser.ts`).

**`src/mainview/` — Frontend SPA:**
- Purpose: Vue 3 + Pinia + PrimeVue (Aura theme) + CodeMirror/Monaco editors + xterm terminals.
- Contains: `main.ts` (bootstrap), `App.vue` (push-handler wiring + boot routing), `router.ts` (2 routes: `/board`, `/setup`), `rpc.ts` (typed API + WS client), `index.html`, `views/` (`BoardView.vue` ~970 lines, `SetupView.vue`), `components/` (~64 feature components: `BoardColumn.vue`, `TaskChatView.vue`, `ConversationPanel.vue`, `TaskDetailOverlay.vue`, `ChatSidebar.vue`, `TerminalPanel.vue`, `WorkflowEditorOverlay.vue`, …), `stores/` (13 Pinia stores: `board.ts`, `task.ts`, `conversation.ts`, `chat.ts`, `workspace.ts`, `project.ts`, `workflow.ts`, `terminal.ts`, `review.ts`, `codeServer.ts`, `drawer.ts`, `draft.ts`, `queue-types.ts`), `composables/` (WS sync handlers `useBoardSyncHandler.ts`, `useSessionSyncHandler.ts`, markdown, typewriter, dark mode, card selection, column transitions), `utils/` (pure display helpers), `api/launch.ts`.
- Tests: co-located `*.test.ts` next to stores/composables/utils (e.g. `src/mainview/stores/board.test.ts`, `src/mainview/composables/useBoardSyncHandler.test.ts`).

**`src/shared/` — Shared contract:**
- Purpose: `rpc-types.ts` (1168 lines — domain types, `RailynAPI`, `StreamEvent`, `PushMessage`, MCP types, model settings), `stream-tree.ts` (block-tree builder, pure).

**`config/`:**
- `engines.yaml` — global engine declarations (copilot, pi-local with models/variants/sampling_presets); `engines.yaml.sample`, `engines.yaml.bak` present.
- `workspace.yaml.sample` — per-workspace config template (projects, allowed_engines, default_model, worktree_base_path, slash prompts, search, anthropic).
- `config.yaml.sample`, `providers.yaml.sample` — samples.
- `workflows/delivery.yaml`, `workflows/openspec-v1.yaml` — bundled workflow templates seeded into every workspace by `src/bun/config/workflows.ts`.
- `workspace.test.yaml` — used by tests.

**`e2e/`:**
- `api/` — `smoke.test.ts`, `workflow.test.ts`, `mcp-oauth.test.ts` + `fixtures/server.ts` (spawns real Bun server, in-memory DB, temp config).
- `ui/` — ~55 Playwright specs, one per feature; `fixtures/` (`mock-api.ts`, `mock-ws.ts`, `mock-data.ts`, `helpers.ts`, `board-helpers.ts`, `setup-helpers.ts`, `index.ts`). Runs against `vite preview` of `dist/` (see `playwright.config.ts`).

**`scripts/`:** `dev.ts` (parallel vite watch + bun server; `--real-db`/`--port=`), `postinstall.ts`, `backfill-tool-call-display.ts`.

**Root files:** `package.json` (bun scripts: `dev`, `prod`, `build`, `test`, `test:e2e:*`, `test:mutation`), `bun.lock` + `package-lock.json` (both committed), `bunfig.toml` (registry scopes), `tsconfig.json` (+ frontend/backend-test variants), `vite.config.ts`, `vitest.config.ts`, `vitest.backend.config.ts`, `playwright.config.ts`, `stryker.backend.json`/`stryker.frontend.json` (mutation testing), `Makefile`, `AGENTS.md`/`CLAUDE.md`, `env.d.ts`, `api-improvements.md`, `railyin.yaml`.

## Key File Locations

**Entry Points:**
- `src/bun/index.ts`: Bun server bootstrap + composition root (`bun run prod`).
- `scripts/dev.ts`: dev launcher (`bun run dev`).
- `src/mainview/main.ts`: SPA bootstrap (Vite).
- `e2e/api/fixtures/server.ts`: test server fixture.
- `test/smoke.ts`, `refinement/runner.ts`, `scripts/backfill-tool-call-display.ts`: utility entries.

**Configuration:**
- `config/engines.yaml`: global engine definitions.
- `config/workflows/*.yaml`: workflow templates (seeded per workspace).
- `src/bun/config/index.ts`: YAML loader + validation; `src/bun/config/workflows.ts`: workflow seeding.
- `src/bun/workspace-context.ts`: workspace-config access shim.
- `tsconfig.json` / `vite.config.ts` / `vitest.config.ts`: aliases `@` → `src/mainview/`, `@shared` → `src/shared/`, `@bun` → `src/bun/`.

**Core Logic:**
- `src/bun/engine/orchestrator.ts`: execution coordination.
- `src/bun/engine/types.ts`: engine contracts (`ExecutionEngine`, `EngineEvent`, `ExecutionParams`).
- `src/bun/engine/execution/*.ts`: per-flow executors.
- `src/bun/engine/engine-registry.ts`: engine resolution.
- `src/bun/handlers/*.ts`: RPC surface.
- `src/shared/rpc-types.ts`: API contract (update this first when adding RPC methods).
- `src/mainview/stores/conversation.ts`: live stream block tree (frontend streaming state).

**Testing:**
- `src/bun/test/`: backend integration tests.
- `src/mainview/**/*.test.ts`: frontend unit tests (co-located).
- `e2e/api/`: API smoke tests; `e2e/ui/`: Playwright specs; `e2e/ui/fixtures/mock-api.ts`: backend mocks.
- `stryker.backend.json` / `stryker.frontend.json`: mutation-testing configs.

## Naming Conventions

**Files:**
- kebab-case `.ts` for backend modules: `transition-executor.ts`, `model-settings-repository.ts`.
- PascalCase for Vue components: `BoardColumn.vue`, `TaskDetailOverlay.vue` (all of `src/mainview/components/`).
- PascalCase exceptions (git/lsp classes): `src/bun/git/WorktreeManager.ts`, `src/bun/git/GitRepositoryManager.ts`, `src/bun/db/repositories/TaskGitContextRepository.ts` — see Architecture anti-patterns.
- kebab-case `.vue` would be inconsistent — always PascalCase for components.
- Tests: `<name>.test.ts` co-located next to the unit under test; Playwright specs `*.spec.ts` in `e2e/ui/`.
- Migrations: `NNN_snake_case.ts` in `src/bun/db/migrations/` (must stay immutable after apply).

**Directories:**
- kebab-case throughout `src/bun/` (`execution/`, `working-directory-resolver.ts`, `chat-sessions.ts`).
- `repositories/` plural for repo layer; `migrations/` for schema migrations.

**Functions:**
- camelCase; handler factories named `<domain>Handlers` (`taskHandlers`, `boardHandlers`); store factories `use<Name>Store` (`useBoardStore`); composables `use<Name>` (`useBoardSyncHandler`).

**Types:**
- PascalCase interfaces; discriminated unions like `EngineEvent` (`src/bun/engine/types.ts:20`); `I`-prefixed interfaces for dependency-injection seams (`IWorkspaceRepository`, `IBoardToolExecutor`, `IWorkingDirectoryResolver`).

**RPC methods:**
- `<domain>.<action>` dotted strings (e.g. `"tasks.transition"`, `"boards.list"`) — defined once in `RailynAPI` (`src/shared/rpc-types.ts:635`).

## Where to Add New Code

**New API method:**
1. Add the method to `RailynAPI` in `src/shared/rpc-types.ts` (params + response types).
2. Add a handler in the matching `src/bun/handlers/<domain>.ts` factory; wire deps from the factory signature (handlers receive `db`, repos, `orchestrator`, notifiers).
3. Call it from the frontend via `api("<domain>.<action>", params)` in `src/mainview/rpc.ts` or directly in a store.

**New AI engine / provider:**
- Implement `ExecutionEngine` (`src/bun/engine/types.ts:193`) in a new dir `src/bun/engine/<name>/` (`engine.ts` + `adapter.ts` + `events.ts` + `tools.ts`), register a factory in `src/bun/index.ts:141-162`, declare the engine in `config/engines.yaml`, add a dialect in `src/bun/engine/dialects/` if it has custom slash-command syntax.

**New frontend feature:**
- Component → `src/mainview/components/<Feature>.vue` (PascalCase); state → a Pinia store in `src/mainview/stores/`; WS-reactive sync logic → a composable in `src/mainview/composables/`; pure display helpers → `src/mainview/utils/` with a co-located `.test.ts`.
- Add `page.route()` mocks in `e2e/ui/fixtures/mock-api.ts` (and `mock-ws.ts` for push events) before writing a Playwright spec in `e2e/ui/`.

**New workflow template:**
- Add `config/workflows/<name>.yaml`; seeding happens automatically for new workspaces (`src/bun/config/workflows.ts`), and existing workspaces are back-filled at boot (`src/bun/index.ts:105-109`).

**New DB table/column:**
- Add `NNN_<name>.ts` to `src/bun/db/migrations/` (next unique number — see Architecture anti-pattern on duplicates); update `row-types.ts`, `mappers.ts`, and any repositories in `src/bun/db/repositories/`. Never edit an applied migration; use `previousChecksums` only for known bugfixes.

**New engine tool (agent-facing):**
- Add to `src/bun/engine/common-tools.ts` (cross-engine) or `src/bun/engine/pi/tools/` (Pi-native) + tool definitions; wire into the engine's `buildAllTools`/tool registry; add validation schemas in `src/bun/engine/validate-tool-args.ts` as needed.

**Background work:**
- Add a job module under `src/bun/jobs/` and start it from `src/bun/index.ts` (pattern: `RetentionJob`, `startChatSessionAutoArchiveJob`).

## Special Directories

**`dist/`:**
- Purpose: Vite build output; served by Bun at boot (`src/bun/index.ts:246`).
- Generated: Yes (by `vite build`).
- Committed: No (gitignored).

**`.railyin/`:**
- Purpose: runtime data inside each project (MCP project config `mcp.json`, tokens, `system-prompts`); also the default data dir name for global state (`~/.railyn`, `getDataDir()`).
- Generated: Yes. Committed: No.

**`.runtime/`:**
- Purpose: temporary runtime dirs for API test fixtures (`e2e/api/fixtures/server.ts:35-45`).
- Generated: Yes. Committed: No.

**`openspec/`:**
- Purpose: OpenSpec-style specs (`openspec/specs/<capability>/spec.md`) and change proposals (`openspec/changes/<change>/` with `proposal.md`, `design.md`, `tasks.md`, `specs/`). Active changes under `changes/`, completed ones under `changes/archive/`.
- Generated: No. Committed: Yes.

**`refinement/`:**
- Purpose: standalone LLM refinement harness (scenario runner against local models — `runner.ts`, `engine-runner.ts`, `providers.ts`, `lmstudio.ts`, `proxy.ts`, `scenarios/`). Operates independently of the main server.
- Generated: No. Committed: Yes.

**`reports/mutation/`:**
- Purpose: Stryker mutation-testing reports.
- Generated: Yes (by `bun run test:mutation`). Committed: Yes (checked in).

**`extensions/railyin-ref/`:**
- Purpose: separate npm project (VS Code-style extension) — `bun run build:ext` compiles/packages it. Not part of the main Bun/Vite build.

**`notes/`:** ad-hoc dev notes (markdown); committed.

**`.github/prompts/`:** `.prompt.md` files referenced from workflow YAML as `/prompt-name` (e.g. `/opsx-propose`, `/test-loop`); resolution happens in `src/bun/engine/execution/slash-command-resolver.ts` and prompt assembly.

---

*Structure analysis: 2026-08-08*
