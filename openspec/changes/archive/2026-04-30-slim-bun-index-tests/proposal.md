## Why

The `slim-bun-index-bootstrap` change extracts five server modules from `index.ts` into focused, DI-friendly classes. None of those modules have any direct unit tests today — they were untestable because they lived as inline closures inside a 1189-line bootstrap file.

Now that each module has a clean constructor with injected dependencies (`IBroadcastChannel`, `db`, `getPtySession`, etc.), they can be tested in isolation without spawning a real server. This change delivers that coverage.

The test suite also formalises the contracts established by the refactor: if a future change accidentally breaks the broadcast-error-tolerance guarantee or the idempotent shutdown behaviour, a failing test will catch it immediately.

## What Changes

- **New test directory** `src/bun/test/server/` with six focused unit-test files
- **36 new unit tests** covering all five extracted modules and `setupFileLogging`
- **No new integration or Playwright tests** — the modules are backend-only and the existing `e2e/api/smoke.test.ts` already covers the server start/shutdown path end-to-end

## Capabilities

### New Capabilities

- `bun-server-unit-tests`: Unit test suite for the six `src/bun/server/` modules — `BroadcastChannel`, `NotificationService`, `StreamEventProcessor`, `WebSocketHandler`, `createShutdownHandler`, and `setupFileLogging`

### Modified Capabilities

<!-- none — no existing requirement behaviour changes -->

## Impact

- Adds `src/bun/test/server/` directory (6 new test files, ~36 tests)
- No changes to production code
- Test infrastructure reuses existing helpers: `initDb()`, `makeTempDir()`, `createMockWait()` from `src/bun/test/helpers.ts` and `src/bun/test/support/`
- Depends on `slim-bun-index-bootstrap` being applied first (the modules must exist before they can be tested)
