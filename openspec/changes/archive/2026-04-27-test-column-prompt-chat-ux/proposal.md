## Why

The column prompt chat UX change introduces new behavior at three layers: transition persistence, task-chat rendering, and legacy/new history coexistence. That behavior is not adequately covered by the current mix of backend tests, utility tests, and Playwright suites, so a dedicated test-suite change is needed before implementation starts.

## What Changes

- Define a dedicated coverage contract for the column prompt chat UX feature across unit tests, in-memory integration tests, and Playwright UI tests.
- Add backend test coverage for prompted transition metadata, execution wiring, and duplicate prompt-row suppression using the existing in-memory database harness and dependency-injected seams.
- Add frontend pure-logic coverage for transition formatting and prompt-like chip rendering without introducing a new component-test harness.
- Add Playwright coverage for the structured transition card, collapsed instruction disclosure, chip-style instruction rendering, and legacy/new history compatibility.

## Capabilities

### New Capabilities
- `column-prompt-chat-ux-coverage`: Defines the automated coverage required for the new transition-card workflow UX across unit, integration, and Playwright layers.

### Modified Capabilities
- None.

## Impact

- Backend tests in `src/bun/test/`, especially transition and orchestrator coverage using the in-memory DB helpers.
- Frontend Vitest coverage in `src/mainview/**/*.test.ts` for pure helpers extracted or reused by the feature.
- Playwright UI coverage in `e2e/ui/conversation-body.spec.ts`, `e2e/ui/task-drawer.spec.ts`, and shared mock fixtures.
- Shared test-fixture and mock data paths that need enriched `transition_event` metadata.
