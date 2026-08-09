---
last_mapped_commit: c8816b4cdd04e6992cc7974d588e96fef89c3df1
---
<!-- refreshed: 2026-08-08 -->
# Architecture

**Analysis Date:** 2026-08-08

## System Overview

Railyin is an AI-assisted delivery orchestration tool: a single-process local application that runs a Kanban-style board, delegates task work to pluggable AI coding agents ("engines"), and streams their activity to a Vue frontend over WebSocket. One Bun process serves both the API and the statically built frontend.

```text
┌─────────────────────────────────────────────────────────────────────┐
│                     Vue 3 SPA (`src/mainview/`)                      │
│   Views: `src/mainview/views/BoardView.vue`, `SetupView.vue`        │
│   Pinia stores: `src/mainview/stores/{board,task,chat,conversation} │
│   .ts`  Transport: `src/mainview/rpc.ts` (POST /api/* + WS /ws)     │
└──────────────┬──────────────────────────────────┬───────────────────┘
               │ HTTP POST /api/<method>          │ WS push (stream.event,
               ▼                                  │ task.updated, message.new...)
┌─────────────────────────────────────────────────────────────────────┐
│              Bun server (`src/bun/index.ts`, composition root)      │
│  handlers: `src/bun/handlers/*.ts` (20 modules, one per domain)     │
│  server:   `src/bun/server/{websocket,broadcast-channel,            │
│            stream-processor,notifications,file-logger,shutdown}.ts` │
└──────┬──────────────────┬──────────────────┬────────────────────────┘
       │                  │                  │
       ▼                  ▼                  ▼
┌──────────────┐  ┌─────────────────┐  ┌──────────────────────────┐
│ SQLite DB    │  │ Execution core  │  │ External subsystems       │
│ `src/bun/db/`│  │ `src/bun/engine/│  │ `src/bun/{mcp,git,lsp,    │
│ 54 migrations│  │ orchestrator,   │  │ launch,oauth,jobs}/`      │
│ + repos      │  │ engines/*}      │  │                           │
└──────────────┘  └─────────────────┘  └──────────────────────────┘
```

## Component Responsibilities

| Component | Responsibility | File |
|-----------|----------------|------|
| Bootstrap / composition root | Migrations, config load, engine factory map, handler wiring, Bun.serve, graceful shutdown | `src/bun/index.ts` |
| API handlers | Per-domain RPC methods; DB reads/writes; delegate execution to orchestrator | `src/bun/handlers/*.ts` (e.g. `tasks.ts`, `boards.ts`, `conversations.ts`) |
| Orchestrator | `ExecutionCoordinator` impl; delegates to per-flow executors; model listing, cancellation, compaction, shell approval | `src/bun/engine/orchestrator.ts` |
| EngineRegistry | `engineId → ExecutionEngine` map; per-workspace `allowed_engines` filtering; default-engine fallback | `src/bun/engine/engine-registry.ts` |
| Execution engines | Drive an AI agent session; emit `EngineEvent` async iterables | `src/bun/engine/{claude,copilot,cursor,opencode,pi}/engine.ts` |
| Executors | Orchestrate one flow: transition, human turn, retry, code review, chat | `src/bun/engine/execution/{transition-executor,human-turn-executor,retry-executor,code-review-executor,chat-executor}.ts` |
| StreamProcessor (engine) | AbortController lifecycle; `EngineEvent` state machine; persist + broadcast messages | `src/bun/engine/stream/stream-processor.ts` |
| StreamEventProcessor (server) | Enrich events with `seq`/`blockId`, broadcast, buffer-persist `stream_events` | `src/bun/server/stream-processor.ts` |
| BroadcastChannel | Fan-out JSON to connected WS clients | `src/bun/server/broadcast-channel.ts` |
| Config | YAML loading (workspace, engines, workflows), per-workspace registry, `AsyncLocalStorage` context | `src/bun/config/index.ts`, `src/bun/workspace-context.ts` |
| DB layer | `bun:sqlite` singleton, migrations, row mappers, repositories | `src/bun/db/index.ts`, `src/bun/db/migrations/runner.ts`, `src/bun/db/repositories/*` |
| MCP | Global + per-project MCP client registries, OAuth2 flow, tool discovery | `src/bun/mcp/*`, `src/bun/oauth/*` |
| Git/worktree | Project resolution, git repo manager, worktree lifecycle | `src/bun/git/{ProjectResolver,GitRepositoryManager,WorktreeManager}.ts` |
| Conversation | Message persistence, context estimation, cross-engine context transfer, prompt/stage/decision injectors, model-param policies | `src/bun/conversation/*` |
| LSP | Language server manager, per-task registries, installer | `src/bun/lsp/*` |
| Frontend transport | Typed `api()` calls + WS push dispatch with reconnect backoff | `src/mainview/rpc.ts` |
| Frontend stores | Pinia stores mirroring backend domains; subscribe to push events | `src/mainview/stores/*.ts` |
| Shared contract | `RailynAPI` RPC schema, domain types, `StreamEvent`, `PushMessage` | `src/shared/rpc-types.ts`, `src/shared/stream-tree.ts` |

## Pattern Overview

**Overall:** Single-process local-first server, layered by directory, with a shared type contract, constructor-injected dependencies assembled in a composition root, and a config-driven (YAML) engine/workflow model.

**Key Characteristics:**
- **Local-first single process**: Bun serves HTTP + WebSocket + static `dist/` from one entry point (`src/bun/index.ts`). No external DB, no auth, no deployment.
- **Shared type contract**: `src/shared/rpc-types.ts` is the single source of truth for the API surface (`RailynAPI` — ~150 typed RPC methods) and push event types. Backend handlers and frontend `rpc.ts` both import from it.
- **Engine plugin model**: every AI provider is an `ExecutionEngine` (`src/bun/engine/types.ts:193`) exposing `execute(params): AsyncIterable<EngineEvent>`. Engines are constructed via a factory map in the composition root (`src/bun/index.ts:141-162`) and stored in an `EngineRegistry`.
- **Stream-first UI**: all live activity flows as typed `StreamEvent`s over WS (`stream.event`); the UI builds a block tree from them (`src/shared/stream-tree.ts`, `src/mainview/stores/conversation.ts`). Persisted messages (`conversation_messages`) and live stream blocks are two layers that must stay aligned.
- **Config-driven workflow behavior**: column transitions, `on_enter_prompt`, `stage_instructions`, WIP limits, allowed transitions live in YAML (`config/workflows/*.yaml`), not code. Task movement enforces those configs at runtime (`src/bun/workflow/transition-validator.ts`, `src/bun/engine/execution/transition-executor.ts`).
- **Constructor injection with interfaces**: `IWorkspaceRepository`, `IBoardToolExecutor`, `IWorkingDirectoryResolver`, `IProjectResolver`, `ITaskGitContextRepository` are interfaces; concrete impls (SQLite/git-based) are wired in `src/bun/index.ts`.
- **Write buffering**: DB writes for high-frequency data (stream events, raw model messages) go through batched `WriteBuffer`s (`src/bun/pipeline/write-buffer.ts`, `src/bun/engine/stream/raw-message-buffer.ts`).

## Layers

**Shared contract (`src/shared/`):**
- Purpose: Types shared by backend and frontend; no runtime imports from either side.
- Contains: `rpc-types.ts` (domain types, `RailynAPI` RPC schema, `StreamEvent`, `PushMessage`), `stream-tree.ts` (pure function building the block tree from flat stream events).
- Depends on: nothing.
- Used by: everything.

**Frontend (`src/mainview/`):**
- Purpose: Vue 3 SPA. Views are thin; logic lives in Pinia stores; composables extract reusable WS-sync behavior.
- Contains: `views/` (BoardView, SetupView), `components/` (~64 `.vue` presentational/feature components), `stores/` (13 Pinia stores), `composables/` (WS sync handlers, markdown, typewriter, card selection), `utils/` (pure display helpers with co-located unit tests), `rpc.ts`.
- Depends on: `@shared/rpc-types` via `rpc.ts`; the Bun server (API + WS).
- Used by: the browser only.

**Backend core (`src/bun/`):**
- Purpose: HTTP/WS server, domain logic, engine execution, persistence.
- Contains: `index.ts` (composition root), `handlers/` (RPC methods), `engine/` (execution), `db/`, `config/`, `conversation/`, `workflow/`, `server/`, plus subsystems (`mcp/`, `git/`, `lsp/`, `launch/`, `oauth/`, `jobs/`).
- Depends on: `src/shared/rpc-types.ts` for all cross-boundary types.
- Used by: the frontend via HTTP + WS.

**Configuration (`config/`):**
- Purpose: YAML user configuration: `engines.yaml` (global engine declarations), `workspace.yaml` (per-workspace, in data dir), `workflows/*.yaml` (column state machines). Sample files checked in; real config lives under the platform data dir (`~/.railyn`).
- Contains: `engines.yaml`, `workspace.yaml.sample`, `config.yaml.sample`, `providers.yaml.sample`, `workflows/{delivery,openspec-v1}.yaml`, `workspace.test.yaml`.
- Loaded by: `src/bun/config/index.ts` (`loadConfig`), accessed via `src/bun/workspace-context.ts` (`getWorkspaceConfig`), scoped per-workspace via `runWithConfig` (AsyncLocalStorage).

**Tests (`src/bun/test/`, `src/mainview/**/*.test.ts`, `e2e/`):**
- Purpose: Unit/integration tests (vitest + bun:sqlite in-memory) and Playwright E2E (UI specs mock the backend entirely via `e2e/ui/fixtures/mock-api.ts`; API specs spawn a real server via `e2e/api/fixtures/server.ts`).

## Data Flow

### Primary Request Path (task transition)

1. **User action** — drag a card or click a transition button in `src/mainview/components/BoardColumn.vue` / `TaskDetailOverlay.vue` → store action in `src/mainview/stores/task.ts` → `api("tasks.transition", { taskId, toState })` (`src/mainview/rpc.ts:20`).
2. **HTTP routing** — `POST /api/tasks.transition` handled in `src/bun/index.ts:306-329`: slices the method name, looks it up in `allHandlers`, JSON-parses params, invokes, wraps errors in `{ error }` with 500.
3. **Handler** — `taskHandlers()` in `src/bun/handlers/tasks.ts` validates the transition (`src/bun/workflow/transition-validator.ts`), then calls `orchestrator.executeTransition(taskId, toState)`.
4. **Orchestration** — `Orchestrator.executeTransition` (`src/bun/engine/orchestrator.ts:137`) delegates to `TransitionExecutor.execute` (`src/bun/engine/execution/transition-executor.ts:43`), which: fetches task, creates/links `conversations` row, writes `workflow_state`, appends a `transition_event` message (`src/bun/conversation/messages.ts`), inserts an `executions` row, resolves the model (`src/bun/engine/execution/model-resolver.ts`), and resolves the engine via `EngineRegistry.resolveEngineForModel`.
5. **Execution** — the executor builds `ExecutionParams` (`src/bun/engine/execution/execution-params-builder.ts`), creates an `AbortController` via `StreamProcessor.createSignal` (`src/bun/engine/stream/stream-processor.ts`), and consumes the engine's `AsyncIterable<EngineEvent>`.
6. **Streaming** — `StreamProcessor.consume()` runs the `EngineEvent` state machine (token/tool/ask_user/shell_approval/done/error), persisting messages and emitting `StreamEvent`s via `StreamEventProcessor` (`src/bun/server/stream-processor.ts`), which enriches each event with `seq`/`blockId` (`src/bun/pipeline/stream-event-enricher.ts`), broadcasts to WS clients, and buffers persisted types into `stream_events` (flushed by `WriteBuffer`, max batch 100 / 500 ms).
7. **UI reception** — `src/mainview/rpc.ts` `onmessage` dispatches push messages to store callbacks wired in `src/mainview/App.vue:44-98`; `conversationStore.onStreamEvent` builds the live block tree; `taskStore.onTaskStreamEvent` updates execution state; board cards re-render.

### Chat Session Flow

1. `src/mainview/components/ChatSidebar.vue`/`ConversationInput.vue` → `chatStore` → `api("chatSessions.sendMessage", …)` → `src/bun/handlers/chat-sessions.ts` → `orchestrator.executeChatTurn` (`src/bun/engine/orchestrator.ts:172`) → `ChatExecutor` (`src/bun/engine/execution/chat-executor.ts`) — same streaming path, with `taskId = null` and `conversationId` as the universal routing key.

### Push Event Flow

1. Any engine event or DB mutation triggers `NotificationService` (`src/bun/server/notifications.ts`) → `BroadcastChannel.broadcast` (`src/bun/server/broadcast-channel.ts:12`) → every connected WS client (`src/bun/server/websocket.ts`).
2. Push message types: `stream.event`, `stream.error`, `task.updated`, `message.new`, `workflow.reloaded`, `code.ref`, `chatSession.updated`, `lsp.install.line` (dispatched in `src/mainview/rpc.ts:90-103`).

**State Management:**
- Backend: SQLite (`bun:sqlite`, WAL mode, singleton in `src/bun/db/index.ts`), plus in-memory `BroadcastChannel` client sets, engine session stores, and `McpRegistryPool` caches. Per-workspace config scoping via AsyncLocalStorage (`runWithConfig` in `src/bun/config/index.ts`).
- Frontend: Pinia stores (`src/mainview/stores/*.ts`); live streaming state in `conversation.ts` (block tree per `conversationId`), with `localStorage` persistence for UI prefs (`src/mainview/utils/storage.ts`).

## Key Abstractions

**`ExecutionEngine` (`src/bun/engine/types.ts:193`):**
- Purpose: uniform plugin interface over AI coding agents (Pi, Claude, Copilot, Cursor, OpenCode, scripted).
- Examples: `src/bun/engine/pi/engine.ts`, `src/bun/engine/claude/engine.ts`, `src/bun/engine/copilot/engine.ts`, `src/bun/engine/cursor/engine.ts`, `src/bun/engine/opencode/engine.ts`, `src/bun/testing/mock-engine.ts`.
- Pattern: `execute(params: ExecutionParams): AsyncIterable<EngineEvent>`; engines are constructed by factories in `src/bun/index.ts:141-162`.

**`EngineEvent` (`src/bun/engine/types.ts:20`):**
- Purpose: discriminated union of everything an engine can emit (`token`, `reasoning`, `tool_start`, `tool_result`, `ask_user`, `decision_request`, `shell_approval`, `subagent_*`, `compaction_*`, `usage`, `done`, `error`).
- Consumed by: `StreamProcessor.consume()` (`src/bun/engine/stream/stream-processor.ts`).

**`StreamEvent` (`src/shared/rpc-types.ts:608`):**
- Purpose: the wire/UI event format; enriched with `seq` + `blockId` by `StreamEventEnricher` (`src/bun/pipeline/stream-event-enricher.ts`) so the frontend can assemble a block tree (`src/shared/stream-tree.ts`).
- Persisted types: `user`, `assistant`, `reasoning`, `tool_call`, `tool_result`, `file_diff`, `system`; ephemeral: `text_chunk`, `reasoning_chunk`, `status_chunk`, `usage`, `done` (`src/bun/server/stream-processor.ts:14-16`).

**`ExecutionCoordinator` (`src/bun/engine/coordinator.ts`):**
- Purpose: the interface handlers use to trigger executions (transition, human turn, retry, code review, chat turn, cancel, compact, list models/commands). Implemented by `Orchestrator`; handlers depend on the interface for testability.

**`RailynAPI` (`src/shared/rpc-types.ts:635`):**
- Purpose: maps every RPC method name to `{ params, response }`; powers type-safe `api()` calls in `src/mainview/rpc.ts` and typed handler signatures.

**`ExecutionParams` (`src/bun/engine/types.ts:64`):**
- Purpose: everything an engine needs for one run: `executionId`, `taskId`/`conversationId` (conversationId is the universal routing key), resolved prompt, system instructions, working directory, model, AbortSignal, MCP visibility filter, sampling preset, model params, callbacks (`onTransition`, `onHumanTurn`, `onSoftCancel`).

**`WriteBuffer<T>` (`src/bun/pipeline/write-buffer.ts`):**
- Purpose: batched, delayed DB persistence (stream events, raw model messages) to keep hot paths off synchronous SQLite writes. Flush on batch size or interval, and on `done`.

**Dialect registry (`src/bun/engine/dialects/`):**
- Purpose: per-engine command dialects (Claude/Copilot/Cursor slash-command syntax, null dialect), selected by `createDefaultDialectRegistry()` (`src/bun/engine/dialects/registry.ts`), used by the Pi engine's `SlashCommandResolver` (`src/bun/engine/execution/slash-command-resolver.ts`).

## Entry Points

**Bun server:**
- Location: `src/bun/index.ts` (run via `bun run dev` → `scripts/dev.ts`, or `bun run prod` → `bun src/bun/index.ts`).
- Triggers: process start; `--port=` flag; `--memory-db` / `RAILYN_DB=:memory:` for tests; `__RAILYN_FORCE_DEBUG__`/`__RAILYN_FORCE_MEMORY_DB__` compile-time defines.
- Responsibilities: resolve shell env, run migrations, seed default workspace + workflows, start MCP registry, build engine instances, mount `/api/*` handlers, start retention job, serve `dist/`, manage WS upgrades (`/ws`, `/ws/pty/*`), handle MCP OAuth callback, graceful shutdown.

**Frontend:**
- Location: `src/mainview/main.ts` (Vite entry; `vite build` outputs `dist/`).
- Triggers: browser load. Boot logic lives in `src/mainview/App.vue` (`onMounted`): register push handlers, load workspaces/boards, route to `/setup` or `/board`.

**Test fixtures:**
- `e2e/api/fixtures/server.ts` — spawns a real Bun server with temp config + in-memory DB for API tests.
- `playwright.config.ts` — serves `dist/` via `vite preview` (no Bun server) for UI specs; all backend traffic mocked via `e2e/ui/fixtures/mock-api.ts`.

**Utility scripts:**
- `scripts/dev.ts` (dev launcher), `scripts/postinstall.ts`, `scripts/backfill-tool-call-display.ts`, `test/smoke.ts`, `refinement/runner.ts` (LLM refinement harness — separate subsystem under `refinement/`).

## Architectural Constraints

- **Threading:** Single-threaded Bun event loop; no worker threads. Long-running engine sessions are async; PTY sessions use Bun's native terminal API (`src/bun/launch/pty.ts`).
- **Global state:** module-level singletons — SQLite DB `_db` in `src/bun/db/index.ts` (reset via `_resetForTests`/`_softResetForTests`), PTY session map in `src/bun/launch/pty.ts`, task LSP registry in `src/bun/lsp/task-registry.ts`. `src/bun/engine/pi/engine.ts` calls `getDb()` directly — engines must not bypass injected repos.
- **Circular imports:** resolved by late-binding — `StreamEventProcessor.setMarkClaudeExecution` after construction (`src/bun/index.ts:231-235`); `Orchestrator` receives `onTransition`/`onHumanTurn` callbacks that point back at itself (`src/bun/engine/orchestrator.ts:99-101`).
- **Migration integrity:** migration files in `src/bun/db/migrations/` are immutable after being applied — checksum-verified by `src/bun/db/migrations/runner.ts`; amendments allowed only via `previousChecksums`. Filename sort order must match ID sort order (validated at startup).
- **RPC contract discipline:** any change to a `RailynAPI` method requires updating the backend handler (`src/bun/handlers/*`) and the frontend consumer (`src/mainview/rpc.ts` or stores) together. Path aliases: `@` → `src/mainview/`, `@shared` → `src/shared/`, `@bun` → `src/bun/` (`tsconfig.json`, `vite.config.ts`, `vitest.config.ts`).
- **UI test isolation:** Playwright UI specs must mock API + WS via `e2e/ui/fixtures/mock-api.ts`; they must not hit a real Bun server.
- **Config-driven behavior:** workflow logic (column IDs, `on_enter_prompt`, tool scopes, WIP limits) belongs in YAML, not hardcoded in handlers.

## Anti-Patterns

### Duplicate migration numbers

**What happens:** multiple migration files share a sequence number (e.g. `007_line_comments.ts` + `007_shell_command_approval.ts`, `008_hunk_decisions_sent.ts` + `008_task_todos.ts`, `016_execution_checkpoints.ts` + `016_task_position.ts`, `018_git_base_sha.ts` + `018_stream_events.ts`) in `src/bun/db/migrations/`.
**Why it's wrong:** readability and risk — the numeric sequence no longer maps 1:1 to history; correctness depends entirely on the filename-sort == ID-sort validation in `src/bun/db/migrations/runner.ts:55-67`.
**Do this instead:** use unique, monotonically increasing prefixes (e.g. `054_mcp_tools_visible_by_default.ts` → `055_…`) when adding new migrations.

### Two similarly named stream processors

**What happens:** `StreamProcessor` (`src/bun/engine/stream/stream-processor.ts`, engine-event state machine) and `StreamEventProcessor` (`src/bun/server/stream-processor.ts`, WS enrichment/broadcast/persistence) differ by one word.
**Why it's wrong:** easy to import the wrong class or misread a trace; both take a `Database` in their constructors and both handle "stream" concerns.
**Do this instead:** keep the naming distinction documented and verify the import path when touching either; consider renaming one (e.g. `EngineEventProcessor` vs `StreamEventProcessor`).

### Inconsistent file casing for class files

**What happens:** PascalCase filenames for git classes (`src/bun/git/GitRepositoryManager.ts`, `src/bun/git/WorktreeManager.ts`, `src/bun/git/ProjectResolver.ts`, `src/bun/db/repositories/TaskGitContextRepository.ts`) coexist with kebab-case for everything else (`src/bun/db/repositories/model-settings-repository.ts`, `src/bun/git/diff-utils.ts`).
**Why it's wrong:** naming-convention lookups and case-sensitive tooling behave unpredictably; two conventions for the same thing.
**Do this instead:** follow the dominant kebab-case convention (`src/bun/db/repositories/*-repository.ts`) for new files.

## Error Handling

**Strategy:** handlers catch and convert exceptions to `{ error: message }` with HTTP 500 (`src/bun/index.ts:321-328`); global `unhandledRejection`/`uncaughtException` loggers registered at boot (`src/bun/index.ts:64-69`); config load failures surface as a broadcast `stream.error` with `taskId: -1` sentinel (`src/bun/index.ts:377-384`) which the frontend maps to a config-error toast + redirect to `/setup` (`src/mainview/App.vue:46-52`).

**Patterns:**
- Engines emit `{ type: "error"; fatal?: boolean }` events rather than throwing across the boundary (`src/bun/engine/types.ts:49`); `StreamProcessor` consumes them and persists failures.
- Cancellation is idempotent: `orchestrator.cancel` (`src/bun/engine/orchestrator.ts:182`) aborts the controller, calls `registry.cancelAll`, and only flips status to `cancelled` for rows still `running`.
- Migration failures abort the process (`process.exit(1)` in `src/bun/db/migrations/runner.ts:180`) — the DB is backed up before applying pending migrations (`backupDb`).
- Engine construction failures are caught per-engine and logged; the engine is skipped (`src/bun/index.ts:177-182`).

## Cross-Cutting Concerns

**Logging:** console + optional file logging via `setupFileLogging()` (`src/bun/server/file-logger.ts`, invoked at `src/bun/index.ts:61`); prefixed tags like `[engine]`, `[mcp]`, `[db]`, `[api]`; `RAILYN_DEBUG=1` enables a debug server with `/shutdown` for e2e (`src/bun/index.ts:359-374`).

**Validation:** `ajv` + JSON Schema for engine tool inputs (`src/bun/engine/validate-tool-args.ts`), `zod` (dependency) and config validation in `src/bun/engine/pi/pi-config-validation.ts`; workflow transition validation in `src/bun/workflow/transition-validator.ts`; migration checksum + ordering validation (`src/bun/db/migrations/runner.ts`).

**Authentication:** none for the local server; MCP OAuth2.1 (PKCE) for external MCP servers via `src/bun/oauth/*` and the `/api/mcp/oauth/callback` endpoint (`src/bun/index.ts:302`); shell-command approval is a human-gated permission flow (`shell_approval` events → `src/bun/handlers/` response endpoints → `orchestrator.respondShellApprovalByExecution`).

**Secrets:** API keys live in YAML config (`config/engines.yaml`, per-provider `api_key`) or env vars; token storage for MCP OAuth in `<scope-dir>/mcp-tokens.json` (`src/bun/mcp/registry-pool.ts:34`). `.env` files are not used — see `config/` samples for shape.

---

*Architecture analysis: 2026-08-08*
