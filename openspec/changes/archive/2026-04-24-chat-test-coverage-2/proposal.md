## Why

The recent chat/session work rewrote major surfaces, but the automated coverage did not keep up. Key task drawer specs were planned and never created, session interactions are under-covered, and API integration coverage still ignores chat sessions and real fake-engine chat flows.

## What Changes

- Add the missing Playwright coverage for the unified task drawer and shared conversation body behavior.
- Extend session Playwright coverage for send/receive, turn changes, cancel-in-flight, archive, and rename flows.
- Expand API integration coverage for standalone sessions, including chat flows without tasks and conversation reads keyed by `conversationId`.
- Use the existing fake provider/engine test setup to exercise real in-memory chat interaction paths instead of mock-only coverage.

## Capabilities

### New Capabilities
- `chat-regression-coverage`: Automated regression coverage for the shared chat surfaces and standalone session APIs

### Modified Capabilities

## Impact

- Playwright suites in `e2e/ui/`, especially new coverage for task drawer and conversation body behavior
- API integration tests in `e2e/api/smoke.test.ts` and supporting fixtures
- Fake provider/engine test helpers used to validate real chat execution behavior in memory
- No product behavior changes; this change improves confidence and regression detection
