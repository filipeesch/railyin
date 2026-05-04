## Context

The `lsp-ui-config-fix` change fixes five systemic bugs and two pre-existing UI bugs across the LSP subsystem. Three DI seams were introduced as part of that change specifically to enable clean testing:

1. `TaskLSPRegistry(managerFactory?)` — swappable factory prevents real LSP process spawning in unit tests
2. `lspHandlers(db, registry?, installer?)` — swappable registry and installer enable handler integration tests without touching the filesystem or spawning processes
3. `setupTestConfig(... extraWorkspaces?)` — multi-workspace configs can be created in-memory for isolation tests

The existing `lsp.test.ts` covers filesystem detection, `probeInstalled`, `addServerToConfig`, `LSPClient` framing, and `LSPServerManager` routing — but nothing about `TaskLSPRegistry` behavior or the handlers themselves.

The Playwright `api.capture()` fixture is fully available — captures RPC call params for assertion.

## Goals / Non-Goals

**Goals:**
- Full unit coverage of `TaskLSPRegistry` state machine (getManager, stale path, idle timer, release)
- Integration coverage of `lspHandlers` with injected fakes (workspace isolation, fallback path)
- `ExecutionParamsBuilder.build()` asserts `workspaceKey` is set
- Orchestrator asserts `workspaceKey` propagates to engine params
- Playwright coverage of "Configure LSP" project row button and `LspSetupPrompt` `dismissOnly` behavior

**Non-Goals:**
- Real LSP server process tests (existing `LSPServerManager` routing tests already cover that)
- `lsp.detectLanguages` backend coverage (existing filesystem tests in `lsp.test.ts` cover it)
- Performance or load testing

## Decisions

### Decision: Test `TaskLSPRegistry` in isolation via injected `managerFactory`

The factory is injected at construction time. Tests pass a `vi.fn()` that returns a spy manager object `{ request: vi.fn(), requestWorkspaceSymbol: vi.fn(), shutdown: vi.fn() }`. No real LSPServerManager is created, no LSP binary is needed.

**Alternatives considered:**
- Mock `LSPServerManager` module via `vi.mock`: couples tests to module path, harder to maintain

### Decision: Inject fake registry and installer into `lspHandlers` for handler integration tests

Handler tests use `initDb()` + `setupTestConfig(extraWorkspaces)` for a real in-memory DB with two workspaces, and inject a `fakeRegistry` + `fakeInstaller` via the DI seams. The `addServerToConfig` filesystem call still runs against tmp files (it's already well-tested in isolation and cheap to run).

**Alternatives considered:**
- vi.mock on registry and installer: works but is less explicit about what is being substituted

### Decision: Playwright tests live in `workspace-settings.spec.ts`

The new LSP actions are part of the Setup view → Projects tab, which is already fully covered in `workspace-settings.spec.ts`. Adding new suites `L` and `LP` there is consistent with the existing suite naming (`S`, `W`, `P`, `C`, `E`).

## Risks / Trade-offs

- **[Risk] Idle timer test is time-sensitive** → Use `vi.useFakeTimers()` + `vi.advanceTimersByTime()` to avoid real 10-minute waits
- **[Trade-off] Handler tests write real `workspace.yaml` tmp files** → Acceptable; `addServerToConfig` is cheap and already proven correct. The alternative (injecting config writer too) would over-engineer the test seam

## Open Questions

None.
