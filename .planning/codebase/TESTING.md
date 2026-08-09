---
last_mapped_commit: c8816b4c
---
# Testing Patterns

**Analysis Date:** 2026-08-08

## Test Framework

**Runner:**
- Backend + API tests: Bun's native test runner (`bun test`) using `bun:test`/`vitest` imports — `bun test src/bun --timeout 20000` (`package.json:13`). Most backend files import from `"vitest"` (e.g., `src/bun/test/column-config.test.ts:1`), a few from `"bun:test"` (e.g., `src/bun/test/boards.test.ts:11`); both run under `bun test`.
- Frontend unit tests: Vitest 3 (`vitest.config.ts`, include `src/mainview/**/*.test.ts`).
- Vitest backend config: `vitest.backend.config.ts` (include `src/bun/test/**/*.test.ts`, `pool: "forks"`, `environment: "node"`, `globals: false`, setup files in `src/bun/test/shims/`). Used by Stryker; `bun test` remains the primary runner.
- E2E UI: Playwright `^1.59.1` (`playwright.config.ts`, `testDir: "e2e/ui"`, `testMatch: "**/*.spec.ts"`).

**Assertion Library:**
- `expect` from vitest/bun:test (`expect(...).toBe(...)`, `toContain`, `toHaveLength`, `toHaveBeenCalledWith`, `toStartWith` in `e2e/api/smoke.test.ts:501`).
- Playwright's `expect` with auto-retrying web-first assertions (`await expect(page.locator(".msg--user")).toHaveCount(...)` in `e2e/ui/chat.spec.ts:55`).

**Run Commands:**
```bash
bun test src/bun --timeout 20000            # All backend tests (vitest/bun:test)
bun test src/bun/test/orchestrator.test.ts  # Single backend test file
bun test src/mainview/stores/conversation.test.ts  # Frontend unit test
bun test e2e/api --timeout 30000            # API smoke tests (real Bun server spawned)
bun run test:e2e                            # Full Playwright suite (build first)
bun run test:e2e:chat                       # Single Playwright spec
bun run test:mutation                       # Stryker mutation tests (backend + frontend)
bun run typecheck                           # tsc --noEmit (CI static gate)
```

## Test File Organization

**Location:**
- Backend: centralized in `src/bun/test/`, mirroring `src/bun/` module names (`src/bun/test/orchestrator.test.ts` ↔ `src/bun/engine/orchestrator.ts`). Subdirectories mirror engine/server structure: `src/bun/test/pi/`, `src/bun/test/cursor/`, `src/bun/test/server/`, `src/bun/test/integration/`.
- Frontend: co-located `*.test.ts` next to the module under test (`src/mainview/stores/conversation.test.ts`, `src/mainview/composables/useCardSelection.test.ts`, `src/mainview/utils/pairToolMessages.test.ts`).
- E2E UI: `e2e/ui/*.spec.ts` with shared fixtures in `e2e/ui/fixtures/`.
- API: `e2e/api/*.test.ts` with the server fixture in `e2e/api/fixtures/server.ts`.

**Naming:** `<module-under-test>.test.ts` (unit) / `<feature>.spec.ts` (Playwright).

**Shared test helpers:**
- `src/bun/test/helpers.ts` — `initDb()` (in-memory DB with full schema + `PRAGMA foreign_keys = ON`), `setupTestConfig()`, `seedProjectAndTask(db, gitDir)`, `makeTestRegistry(engine)` / `makeTestRegistryWith(engines)` for wiring fake engines into the orchestrator.
- `src/bun/test/shims/bun-globals.ts` — installs `globalThis.Bun` (`serve`, `file`, `write`, `which`, `spawn`, `CryptoHasher`) for vitest runs; loaded first in `setupFiles`.
- `src/bun/test/shims/bun-sqlite.ts` — `bun:sqlite` → better-sqlite3 compatibility shim for Vite/Stryker transform.
- `src/bun/test/shims/vitest-teardown.ts` — `afterAll(closeAll)` closes better-sqlite3 connections to prevent macOS SIGSEGV; must be listed after `bun-globals.ts` (`src/bun/test/shims/vitest-teardown.ts:14`).

## Test Structure

**Suite Organization:**

Backend unit (`src/bun/test/orchestrator.test.ts:84`):
```typescript
describe("Orchestrator.executeTransition", () => {
  it("updates workflow_state via configured engine", async () => {
    const { taskId } = seedProjectAndTask(db, gitDir);
    // ... arrange / act
    expect(task.workflowState).toBe("plan");
    // assert persisted DB state too
    const row = db.query("SELECT workflow_state FROM tasks WHERE id = ?").get(taskId);
    expect(row!.workflow_state).toBe("plan");
  });
});
```

Frontend unit (`src/mainview/stores/conversation.test.ts:24`):
```typescript
describe("conversationStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    apiMock.mockImplementation(async () => ({ messages: [], hasMore: false }));
  });
  it("only appends pushed messages for the active conversation", () => { ... });
});
```

API smoke (`e2e/api/smoke.test.ts:45`): file-level `beforeAll(async () => { server = await startServer(); }, 20_000)` / `afterAll(async () => { await server.shutdown(); })`; suites grouped by domain (`describe("tasks", ...)`); tests in each suite share state via closure `let boardId: number;` populated in suite-level `beforeAll`.

**Patterns:**
- Each test is self-contained: arrange (seed DB / register mocks) → act (call API) → assert (result + persisted state). Backend tests re-seed per test and assert on DB rows directly, not just API return values.
- Tests document requirement IDs in names (`"S-1: ..."`, `"M-1: ..."`, `"Task 9.1: ..."`).
- Long timeouts passed as third arg to `it` for slow orchestration tests: `}, 10_000);` (`src/bun/test/orchestrator.test.ts:134`).
- Per-test temp dirs via `mkdtempSync(join(tmpdir(), "railyn-*"))` with `rmSync(dir, { recursive: true, force: true })` in `afterEach` (`src/bun/test/orchestrator.test.ts:67-80`, `src/bun/test/db-migrations.test.ts:12-23`).

## Mocking

**Framework:** vitest `vi` for frontend; fake engine classes for backend; Playwright `page.route()` / `page.routeWebSocket()` for E2E.

**Frontend module mocking** (`src/mainview/stores/conversation.test.ts:4`):
```typescript
const apiMock = vi.fn(async (..._args: unknown[]): Promise<unknown> => []);
vi.mock("../rpc", () => ({
  api: (...args: Parameters<typeof apiMock>) => apiMock(...args),
}));
const { useConversationStore } = await import("./conversation");
```
- The mock is declared before the dynamic `await import` of the module under test; each test re-stubs `apiMock.mockImplementation(...)` per scenario.

**Backend engine mocking:** tests implement `ExecutionEngine` inline (fake `TestEngine` yielding scripted events, `src/bun/test/orchestrator.test.ts:33`) and register via `makeTestRegistry(new TestEngine())`. No real model calls are made; provider adapters have their own dedicated tests (`src/bun/test/claude-adapter.test.ts`, `src/bun/test/copilot-sdk-adapter.test.ts`, `src/bun/test/cursor/adapter.test.ts`).

**Playwright API mocking** (`e2e/ui/fixtures/mock-api.ts`):
- `ApiMock` class: `handle(method, (params) => value)`, `returns(method, value)`, `delayed(method, value, delayMs)`, `capture(method, returnValue)` (returns a live call log array). One `page.route("/api/**")` dispatches by method name; unhandled methods return 501 so missing stubs fail loudly (`mock-api.ts:90`).
- Typed against `RailynAPI` so mock handlers enforce the shared contract: `handle<M extends keyof RailynAPI>(method: M, handler: (params: RailynAPI[M]["params"]) => RailynAPI[M]["response"] | Promise<...>)` (`mock-api.ts:34`).
- WebSocket mocking: `WsMock` with `page.routeWebSocket("/ws")`, `push(msg)`, `pushStreamEvent(event)`, `pushDone(taskId, executionId)`, `nextMessage()` (`e2e/ui/fixtures/mock-ws.ts`). Messages pushed before the socket opens are queued and drained on connect.
- Auto-use fixtures in `e2e/ui/fixtures/index.ts`: `ws` and `api` are `{ auto: true }`; `api` pre-registers baseline handlers for every endpoint the app calls on first load (workspace, boards, tasks, models, conversations, chat sessions, notes, decisions). Tests override per scenario.
- Stream events are injected with a `setTimeout` after the HTTP response to simulate async streaming (`e2e/ui/chat.spec.ts:65`).

**What to Mock:**
- Frontend unit tests: always mock `src/mainview/rpc.ts` (network boundary); never spin a server.
- E2E UI: mock all backend traffic (`/api/**` + `/ws`) via fixtures; run against `dist/` served by `vite preview` — no Bun server (AGENTS.md). When a UI feature adds an API call or push event, extend the mocks (`e2e/ui/fixtures/mock-api.ts`, `mock-ws.ts`) rather than starting a real server.
- API tests: real Bun server subprocess (not mocked).

**What NOT to Mock:**
- SQLite persistence in backend unit tests — tests use a real in-memory DB (`initDb()` with `RAILYN_DB=:memory:`) and assert on actual rows.
- The orchestrator in `orchestrator.test.ts` — only the engine is faked; transitions, message persistence, and DB effects are real.
- API smoke tests exercise the real HTTP server (`e2e/api/fixtures/server.ts` spawns `bun src/bun/index.ts` with `RAILYN_FORCE_MEMORY_DB=1`, a temp config dir, and reads the port from stdout).

## Fixtures and Factories

**Test Data:**

Frontend factories (`e2e/ui/fixtures/mock-data.ts`): `makeBoard()`, `makeTask({ id: 1 })`, `makeWorkspace()`, `makeChatSession({ id: 500 })`, `makeUserMessage(taskId, content)`, `makeAssistantMessage(taskId, content)`. The `task`/`session` fixtures in `e2e/ui/fixtures/index.ts:117-125` provide defaults; specs build `StreamEvent` objects with local helpers (`textChunk` in `e2e/ui/chat.spec.ts:21`).

Backend seeding (`src/bun/test/helpers.ts:272,311,442`): `seedProjectAndTask(db, gitDir)` inserts a project + task with git context; `setupTestConfig()` writes a temp workspace config and returns `{ cleanup }`; `makeTestRegistry(engine)` builds an `EngineRegistry` containing the fake engine. Test configs include `default_model: copilot/mock-model` and the mock copilot engine (`e2e/api/fixtures/server.ts:64-78`), which produces `"Mock response: <input>"` for assertions.

**Location:**
- Backend helpers: `src/bun/test/helpers.ts` + `src/bun/test/shims/`.
- E2E fixtures: `e2e/ui/fixtures/` and `e2e/api/fixtures/`.

## Coverage

**Requirements:** No coverage thresholds configured in vitest configs (no `coverage` key in `vitest.config.ts` / `vitest.backend.config.ts`). Mutation testing is the quality gate instead:

- Stryker 9 (`@stryker-mutator/core`, `@stryker-mutator/vitest-runner`, `@stryker-mutator/typescript-checker`) with `coverageAnalysis: "perTest"`.
- `stryker.backend.json`: mutates 33 critical files (engine, handlers, db, pipeline, config); `thresholds: { high: 80, low: 60, break: null }` — informational, does not fail CI.
- `stryker.frontend.json`: mutates `src/mainview/stores/conversation.ts`, `src/mainview/utils/pairToolMessages.ts`, `src/mainview/composables/useCommandsCache.ts`.
- Reports to `reports/mutation/{backend,frontend}/` (html + json), gitignored.

**View Mutation Reports:**
```bash
bun run test:mutation:backend   # stryker run stryker.backend.json
bun run test:mutation:frontend  # stryker run stryker.frontend.json
open reports/mutation/backend/index.html
```

## Test Types

**Unit Tests (backend):** Engine internals (`src/bun/test/pi/engine-*.test.ts`, `src/bun/test/cursor/adapter.test.ts`), config validation (`src/bun/test/config-path-validation.test.ts`, `src/bun/test/pi/config-validation.test.ts`), DB repositories (`src/bun/test/task-repository.test.ts`, `src/bun/test/note-repository.test.ts`), utils (`src/bun/test/diff-utils.test.ts`, `src/bun/test/path-utils.test.ts`).

**Unit Tests (frontend):** Pinia stores (`src/mainview/stores/*.test.ts`), composables (`src/mainview/composables/*.test.ts`), pure utils (`src/mainview/utils/*.test.ts`). Store tests use real Pinia via `setActivePinia(createPinia())` per test.

**Integration Tests:** `src/bun/test/orchestrator.test.ts` (732 lines) drives engines through the orchestrator's public API with a fake engine + real in-memory SQLite + real temp git repo. Also `src/bun/test/integration/pi-sdk-tool-events.test.ts`, `src/bun/test/write-tools-integration.test.ts`, `src/bun/test/stream-pipeline-scenarios.test.ts`.

**API Smoke Tests:** `e2e/api/smoke.test.ts`, `e2e/api/workflow.test.ts`, `e2e/api/mcp-oauth.test.ts` — full-stack against a spawned real server; RPC-style calls via `server.request("method", params)` typed against `RailynAPI` (`e2e/api/fixtures/server.ts:119`).

**E2E UI Tests (Playwright):** ~50 specs in `e2e/ui/` (board, chat, timeline, review overlay, MCP tools, worktree management, ws-reconnect, etc.). `fullyParallel: true`, chromium only, `retries: 2` in CI, `trace: "on-first-retry"`, screenshots on failure. Backend fully mocked; `vite preview` serves `dist/` on a worktree-derived port (4100–4999) to avoid cross-worktree port collisions (`playwright.config.ts:20-22`). Test IDs are lettered by suite (`M`, `N`, `O` in `chat.spec.ts`).

## Common Patterns

**Async Testing — polling helper** (`e2e/api/smoke.test.ts:13`):
```typescript
async function waitFor<T>(load: () => Promise<T>, predicate: (value: T) => boolean, timeoutMs = 10_000, intervalMs = 50): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let lastValue = await load();
  while (!predicate(lastValue)) {
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for expected state: ${JSON.stringify(lastValue)}`);
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
    lastValue = await load();
  }
  return lastValue;
}
```
Used to wait for async engine responses (assistant messages, execution state transitions) instead of fixed sleeps.

**Async Testing — microtask flush** (frontend, `src/mainview/stores/conversation.test.ts:82`): after firing a store action that awaits internally, `await Promise.resolve(); await Promise.resolve();` before asserting, or use `await vi.waitFor(...)` where available.

**Error Testing:** assert thrown messages directly (`await expect(api(...)).rejects.toThrow(...)`); API tests assert both happy path and idempotent repeat calls (`"models.setContextWindow is idempotent"`, `e2e/api/smoke.test.ts:440`).

**Timing overrides:** tests inject zeroed timing via internal config objects (`baseMs === 0` skips jitter in `computeBackoffMs`, `src/bun/ai/retry.ts:71`) so retry tests run instantly.

**DB isolation:** `process.env.RAILYN_DB = ":memory:"` + singleton reset (`_resetForTests`) per test (`src/bun/test/helpers.ts:11`); migration tests use a temp file DB and reset env in `afterEach` (`src/bun/test/db-migrations.test.ts:19-23`).

## CI Integration (`.github/workflows/`)

- `pr-checks.yml` (on PRs to `main`): jobs — `type-check` (`npx tsc --noEmit`), `build` (vite build, uploads `dist/` artifact), `backend-tests` (`bun test src/bun/test --timeout 20000`), `api-tests` (`bun test e2e/api --timeout 30000`), `e2e` (Playwright sharded 1/3 with `--workers=2`, downloads the `dist/` artifact instead of rebuilding), and `e2e-complete` aggregator job for branch protection.
- `mutation.yml` (nightly cron + `workflow_dispatch`): runs backend and frontend Stryker suites, uploads `reports/mutation/**` artifacts (30-day retention).

---

*Testing analysis: 2026-08-08*
