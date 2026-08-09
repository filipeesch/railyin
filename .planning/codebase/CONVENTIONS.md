---
last_mapped_commit: c8816b4c
---
# Coding Conventions

**Analysis Date:** 2026-08-08

## Naming Patterns

**Files:**
- Backend modules: kebab-case (`src/bun/engine/qualified-model-id.ts`, `src/bun/conversation/model-params-policy.ts`) mixed with camelCase (`src/bun/utils/resolve-file-attachments.ts`, `src/bun/db/workspace-repository.ts`). Both styles coexist; match the style of the directory you are adding to.
- Backend test files: `src/bun/test/<module>.test.ts` mirroring the module name (e.g., `src/bun/test/orchestrator.test.ts` tests `src/bun/engine/orchestrator.ts`). Nested directories mirror engine structure: `src/bun/test/pi/`, `src/bun/test/cursor/`, `src/bun/test/server/`, `src/bun/test/integration/`.
- Frontend modules: camelCase for logic files (`src/mainview/utils/pairToolMessages.ts`, `src/mainview/stores/conversation.ts`), kebab-case in a few legacy utils (`src/mainview/utils/chat-chips.ts`). Test files are co-located as `*.test.ts` next to the module (`src/mainview/stores/conversation.test.ts`, `src/mainview/composables/useCardSelection.test.ts`).
- Vue components: PascalCase (`BoardColumn.vue`, `ConversationDrawer.vue`, `ToolCallBlock.vue`) in `src/mainview/components/`.
- Playwright specs: kebab-case `*.spec.ts` in `e2e/ui/` (`board-dnd.spec.ts`, `chat-session-drawer.spec.ts`).
- Fixture/shared test code: kebab-case (`mock-api.ts`, `mock-ws.ts`, `mock-data.ts`, `helpers.ts`).

**Functions:**
- camelCase for functions and methods (`mapTask`, `estimateContextUsage`, `removeScopedLiveBlocks`, `pushDone`).
- Handler factory functions named after their domain: `taskHandlers(...)`, `workspaceHandlers(...)` in `src/bun/handlers/*.ts`.
- Test-overridable internals are exported with a leading underscore: `_softResetForTests`, `_resetForTests` in `src/bun/db/index.ts`, `_RetryTimingConfig` in `src/bun/ai/retry.ts`.

**Variables:**
- camelCase for local variables and module-level mutable state (`activeConversationId`, `_wsRetries`).
- Module-private mutable singletons are prefixed with `_` (`_onStreamError`, `_wsTimer` in `src/mainview/rpc.ts`).
- Private class fields use `_` prefix (`_handlers`, `_page` in `e2e/ui/fixtures/mock-api.ts`).

**Types:**
- Interfaces/types PascalCase (`Board`, `Task`, `StreamEvent`, `ExecutionEngine`) — source of truth in `src/shared/rpc-types.ts`.
- Row types from DB queries suffixed `Row` (`TaskRow` in `src/bun/db/row-types.ts`).
- Dependency interfaces prefixed `I` in some backend areas (`IWorkspaceRepository` in `src/bun/db/workspace-repository.ts`); frontend uses plain interfaces without `I` (`BoardSyncDeps` in `src/mainview/composables/useBoardSyncHandler.ts`).
- Test server types exported as `TestServer`, `StartServerOptions` in `e2e/api/fixtures/server.ts`.

**Constants:**
- UPPER_SNAKE for module-level constants in backend (`RETRYABLE_STATUSES`, `MAX_529_RETRIES`, `BASE_BACKOFF_MS`, `DEFAULT_MAX_STREAM_RETRIES` in `src/bun/ai/retry.ts`; `WS_MAX_BACKOFF_MS` in `src/mainview/rpc.ts`).
- Numeric literals use `_` separators (`128_000`, `32_000`, `10_000`, `30_000`).

**Environment variables:**
- `RAILYN_*` prefix: `RAILYN_DB` (set to `:memory:` in `src/bun/test/helpers.ts`), `RAILYN_STREAM_IDLE_TIMEOUT_MS` (`src/bun/ai/retry.ts`), `RAILYN_FORCE_MEMORY_DB` and `RAILYN_DATA_DIR` (`e2e/api/fixtures/server.ts`), `RAILYN_CLI` (AGENTS.md).

**RPC method names:**
- `<domain>.<verb>` dotted strings (`tasks.list`, `tasks.create`, `chatSessions.getMessages`, `workspace.getConfig`) — keys of the `RailynAPI` map in `src/shared/rpc-types.ts`, implemented as literal keys in handler factory objects in `src/bun/handlers/*.ts`.

## Code Style

**Formatting:**
- No Prettier or ESLint configuration exists (no `.prettierrc`, no `eslint.config.*`, no `biome.json`). `.github/copilot-instructions.md` states: "There is no dedicated lint script in `package.json`."
- De facto style: 2-space indent, double quotes, semicolons, trailing commas in multiline literals (see `src/bun/handlers/tasks.ts`, `src/mainview/stores/conversation.ts`, `vitest.backend.config.ts`). E2E files (`e2e/ui/*.spec.ts`, `playwright.config.ts`) use 4-space indent — match per-directory when editing.
- `bun run typecheck` (`tsc --noEmit`, config `tsconfig.json`) is the only static check; it runs in CI (`.github/workflows/pr-checks.yml`).
- Line length ~100 chars; long parameter lists wrap one-per-line with trailing commas.

**Linting:**
- Not applicable — no linter configured. TypeScript strict mode (`"strict": true` in `tsconfig.json`) is the enforcement mechanism. `@typescript-eslint` is not installed.

## Import Organization

**Order:**
1. External packages (`vue`, `pinia`, `vitest`, `bun:sqlite`, `node:fs`) first.
2. Blank line, then relative/aliased internal imports.

**Extension usage:**
- Backend (`src/bun/`): relative imports use explicit `.ts` extensions — `import { Orchestrator } from "../engine/orchestrator.ts"` (`src/bun/test/orchestrator.test.ts`). `tsconfig.json` has `allowImportingTsExtensions: true`.
- Frontend (`src/mainview/`): extensionless imports — `import { api } from "../rpc"` (`src/mainview/stores/conversation.ts`).

**Path aliases** (defined in `tsconfig.json`, `vitest.config.ts`, `vitest.backend.config.ts`):
- `@/*` → `src/mainview/*` (frontend only)
- `@shared/*` → `src/shared/*` (both; note vitest.config.ts maps `@shared` without wildcard)
- `@bun/*` → `src/bun/*` (backend tests; also used inside some backend source files)

**Type-only imports:**
- Always use `import type` for types (`import type { Database } from "bun:sqlite"`, `import type { Task, ConversationMessage } from "../../shared/rpc-types.ts"`).

## Error Handling

**Patterns:**
- Backend handlers throw plain `Error` with descriptive messages, which the HTTP layer surfaces to the frontend: `throw new Error(\`Task ${params.taskId} not found\`)` (`src/bun/handlers/tasks.ts:68`), `throw new Error(\`Project ${params.projectKey} not found in workspace ${workspaceKey}\`)` (`src/bun/handlers/tasks.ts:86`).
- Custom error classes carry structured data: `ProviderError` with `status` and `retryAfter` fields (`src/bun/ai/retry.ts:12`), consumed by the retry wrapper for retry policy decisions.
- Guard helpers throw early when preconditions fail: `requireOrchestrator` throws `"Engine not initialized — check workspace config"` (`src/bun/handlers/tasks.ts:32`).
- Frontend: `api()` in `src/mainview/rpc.ts:29` throws `new Error(\`api(${method}) failed ${status}: ${text}\`)` on non-OK responses; stores use `try { ... } catch { return fallback }` where tolerant behavior is intended (`tryParseJson` in `src/mainview/stores/conversation.ts:6`).
- Retry-with-backoff for transient failures is centralized in `src/bun/ai/retry.ts` (exponential backoff + jitter, respects `retry-after`, caps at `MAX_BACKOFF_MS`); reuse it rather than writing new retry loops.

## Logging

**Framework:** `src/bun/logger.ts` exports `Logger` type and `realLogger`; engines/retry accept an injected `logger?: Logger` (`src/bun/ai/retry.ts:3,53`) so tests can pass a no-op logger.

**Patterns:**
- Backend production code logs through `realLogger` (levels: info/warn/error) — never `console.log` in `src/bun/` production code.
- Test fixtures may use `console.warn` for diagnostics (`[ApiMock] No handler for: ${method}` in `e2e/ui/fixtures/mock-api.ts:89`).
- Log messages are lowercase sentence fragments without trailing periods.

## Comments

**When to Comment:**
- Module-level header blocks with file purpose and usage examples — every fixture and spec file: `e2e/ui/fixtures/mock-api.ts:1`, `e2e/ui/fixtures/index.ts:1`, `e2e/api/fixtures/server.ts:1`, `src/bun/test/shims/bun-globals.ts:1`.
- JSDoc/TSDoc on exported functions, classes, and interfaces: `ProviderError` (`src/bun/ai/retry.ts:6`), `ApiMock.handle()` (`e2e/ui/fixtures/mock-api.ts:34`), `BoardSyncDeps` fields (`src/mainview/composables/useBoardSyncHandler.ts:4`).
- Section banner comments `// ─── Section name ─────...` divide files into logical parts (`src/bun/ai/retry.ts:4`, `src/bun/test/helpers.ts:8`, `src/mainview/rpc.ts:13`).
- "Why" comments explain non-obvious behavior: shim ordering requirement (`src/bun/test/shims/vitest-teardown.ts:14`), port-hashing rationale (`playwright.config.ts:13`).
- Test IDs in suite/test names document requirements: `"S-1: loadMessages sets hasMoreBefore from wrapped response"` (`src/mainview/stores/conversation.test.ts:91`), `"M-1: ..."` (`e2e/ui/chat.spec.ts:40`), `"Task 9.1: ..."` (`src/bun/test/orchestrator.test.ts:2`).

## Function Design

**Size:** Small, single-purpose helper functions extracted aggressively — `tryParseJson`, `extractToolResultText` (`src/mainview/stores/conversation.ts:6-27`), `computeBackoffMs`, `isRetryableStatus`, `sleep` (`src/bun/ai/retry.ts:66-80`).

**Parameters:** Dependency injection over imports for testability — `useBoardSyncHandler(deps: BoardSyncDeps)` (`src/mainview/composables/useBoardSyncHandler.ts:12`), handler factories receive `(db, wsRepo, orchestrator, onTaskUpdated, worktreeManager, ...)` (`src/bun/handlers/tasks.ts:37`), engines receive injected logger/timing config (`_RetryTimingConfig` in `src/bun/ai/retry.ts:49`).

**Return Values:** Explicit typed returns on every function (`Promise<Task[]>`, `Promise<void>`); optional return values typed as `X | null` (not `undefined`). Handlers returning nothing are typed `Promise<void>`.

## Module Design

**Exports:** Named exports throughout (`export function`, `export const`, `export class`, `export interface`) — no default exports except Vue SFCs (`App.vue`, views/components). Barrel `index.ts` only in `e2e/ui/fixtures/`.

**Backend handler pattern:** Each `src/bun/handlers/<domain>.ts` exports a factory function returning an object literal keyed by RPC method name, matching `RailynAPI` in `src/shared/rpc-types.ts`:

```ts
export function taskHandlers(db: Database, wsRepo: IWorkspaceRepository, orchestrator: ExecutionCoordinator | null, onTaskUpdated: OnTaskUpdated, worktreeManager: WorktreeManager, modelSettingsRepo?: ModelSettingsRepository) {
  return {
    "tasks.list": async (params: { boardId: number }): Promise<Task[]> => { ... },
    "tasks.create": async (params: {...}): Promise<Task> => { ... },
    // ...
  };
}
```
(`src/bun/handlers/tasks.ts:37`)

**Frontend store pattern:** Pinia setup stores (`defineStore("conversation", () => { ... })` in `src/mainview/stores/conversation.ts:92`) using `ref`/`computed`; store actions call `api(method, params)` from `src/mainview/rpc.ts`.

**Shared contract rule:** `src/shared/rpc-types.ts` is the source of truth for API params/responses and push events. Any RPC change must update the shared type, the backend handler in `src/bun/handlers/*`, and the frontend consumer in `src/mainview/rpc.ts` or the relevant Pinia store together (AGENTS.md, `.github/copilot-instructions.md:26`).

**Config-driven rule:** Workflow behavior (columns, `on_enter_prompt`, WIP limits, tool scopes) lives in `config/workflows/*.yaml` and `config/workspace.yaml` — prefer YAML changes over hardcoding behavior (AGENTS.md).

**Vue components:** Composition API with `<script setup lang="ts">`, PascalCase template names, BEM-like class naming (`board-column__header`, `msg--user`, `msg__bubble.streaming`), PrimeVue components (`Badge`, `Button`) — see `src/mainview/components/BoardColumn.vue`.

## Cross-Cutting

**Testability hooks:** Production code exposes `_resetForTests` / `_softResetForTests` singletons (`src/bun/db/index.ts`, `src/bun/config/index.ts`) and honors `RAILYN_DB=:memory:` for in-memory test databases (`src/bun/test/helpers.ts:11`).

**Date handling:** `new Date().toISOString()` for timestamps; DB defaults `datetime('now')`.

---

*Convention analysis: 2026-08-08*
