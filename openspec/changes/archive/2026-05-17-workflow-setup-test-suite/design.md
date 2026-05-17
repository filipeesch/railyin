## Context

`workflow-setup-and-seeding` adds the Workflows tab, `workflow.list/create/delete` RPCs, the `src/bun/config/workflows.ts` module, copy-if-absent seeding, and removes the in-memory `delivery` fallback. This change is the test counterpart — it verifies that work and nothing else.

Test infrastructure already in place:
- **Backend unit/handler**: `vitest` + in-memory SQLite via `initDb()`, config via `setupTestConfig()`, handler factories called directly (`workflowHandlers(db, notify)`, `boardHandlers(db)`) — `src/bun/test/helpers.ts`.
- **e2e/api**: a real Bun server spawned by `e2e/api/fixtures/server.ts` (`startServer()`), driven through `server.request(method, params)`; `writeTestConfig` provisions a temp workspace.
- **e2e/ui**: Playwright with fully-mocked `ApiMock`/`WsMock` fixtures; `api.handle()` is type-safe against `RailynAPI`, `ws.push()` simulates push events; `goToSetup()` navigates to the setup screen.

Decisions already taken (recorded): seeding is made deterministic in tests via the `seedWorkflows` `sourceDir` DI parameter plus a `RAILYN_BUNDLED_WORKFLOWS_DIR` env tier; the Monaco editor overlay is tested shallowly; the new RPCs get `e2e/api` coverage.

## Goals / Non-Goals

**Goals:**
- Layered coverage — unit for pure/fs logic, handler for RPC + guards, `e2e/api` for real-server guard enforcement, Playwright for the UI.
- Every spec scenario in the three feature specs has at least one corresponding test, plus extrapolated edge cases.
- Deterministic, isolated tests: no dependence on whatever files happen to live in the repo's `config/workflows`.

**Non-Goals:**
- No application code changes — all testability seams (`sourceDir` param, env tier) are delivered by the feature change.
- No deep Monaco interaction in Playwright (validation UI is existing behavior covered at the requirement level).
- No mutation-testing or performance work.

## Decisions

### D1 — Layer mapping
Each behavior is tested at the lowest layer that can prove it, and re-tested higher only where the integration seam adds risk.

| Behavior | Unit | Handler | e2e/api | Playwright |
|---|---|---|---|---|
| `seedWorkflows` copy/skip/fallback | ✔ | | | |
| `createWorkflowFile` slug/collision/empty-slug | ✔ | ✔ (via `workflow.create`) | | |
| `evaluateDeletable` (incl. precedence) | ✔ | | | |
| `listWorkflowFiles` / `resolveWorkflowFilePath` | ✔ | | | |
| no-phantom-delivery invariant | ✔ (config integration) | | | |
| `workflow.list` guard metadata | | ✔ | ✔ | |
| delete guard rejections | | ✔ | ✔ | |
| Workflows tab UI / overlay / pencil removal | | | | ✔ |

### D2 — Deterministic seeding source
Unit tests call `seedWorkflows(targetDir, sourceDir)` directly with a temp source they populate per case. The `loadConfig()`-path tests (`setupTestConfig`) and the `e2e/api` server (`writeTestConfig`) set `RAILYN_BUNDLED_WORKFLOWS_DIR` to a controlled fixture directory so seeding never depends on the repo's real `config/workflows`. This keeps any existing test that asserts workflow counts stable.

### D3 — Dependency injection for all doubles
The `notifyReloaded` callback is passed as a spy (`let calls = 0; const notify = () => calls++`). The DB is the in-memory instance from `initDb()`. Boards used to drive the reference guard are created through the real `boardHandlers(db)` rather than raw SQL, so the count query is exercised against realistic rows. No module-internal mocking or monkey-patching.

### D4 — Playwright suites mirror the existing setup-spec structure
A new `e2e/ui/workflow-setup.spec.ts` follows the lettered-suite convention of `board-setup.spec.ts`: **WT** (tab placement), **W** (list rows), **WD** (delete guards + confirm), **WA** (add), **WE** (editor overlay — shallow), **WB** (board-header pencil removed), **WR** (`workflow.reloaded` refresh). Each test registers its `workflow.*` mock state before `goToSetup()`/navigation. A `workflow.list` baseline in `fixtures/index.ts` is added only if non-workflow setup tests start hitting it.

### D5 — Extrapolated edge cases beyond the specs
The suite adds cases the specs imply but do not enumerate: `seedWorkflows` ignoring non-YAML files, `.yml` extension handling, source-missing-but-target-already-populated (no fallback written), `listWorkflowFiles` skipping unparseable YAML, and `workflow.getYaml` throwing for an id with no backing file (the ghost-bug regression).

## Risks / Trade-offs

- **e2e/api and handler guard tests overlap** → intentional; the handler test is fast and exhaustive, the `e2e/api` test proves the real server's `loadConfig()` reload cycle. Kept minimal at the `e2e/api` layer (guard rejections only).
- **Playwright Monaco overlay is only shallowly covered** → accepted per the recorded decision; the editor is unchanged code and its validation is specced under `workflow-yaml-editor`.
- **Tests depend on the feature change landing first** → this change's tasks assume `workflow-setup-and-seeding` is applied; apply order is proposal-stated.
- **`RAILYN_BUNDLED_WORKFLOWS_DIR` left set could leak between tests** → fixtures must clear it in teardown, the same way `setupTestConfig` already clears `RAILYN_CONFIG_DIR`.
