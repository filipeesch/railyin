## Why

The `fix-copilot-lease-timeout` change introduces three runtime fixes and a DI refactor across `session.ts`, `events.ts`, and `engine.ts`. These are subtle, timing-sensitive behaviours (lease eviction guards, watchdog heartbeats, pre-eviction abort signals) that are invisible without automated tests — and highly likely to regress silently. This companion change adds the test suite that locks in correctness and validates the three bugs are fixed.

## What Changes

- **New `copilot-sdk-adapter.test.ts`**: unit tests for `DefaultCopilotSdkAdapter` exercising the eviction guard (Bug A) and `onBeforeEvict` lifecycle (Bug C), using an injected fast `LeaseRegistry`
- **Extended `copilot-events.test.ts`**: two new unit tests for the watchdog heartbeat (Bug B), using injectable `idleTimeoutMs` to avoid 2-minute real-time waits
- **Extended `copilot-rpc-scenarios.test.ts`**: two new integration tests — execution ends as `cancelled` not `failed` after pre-eviction abort (Bug C), and a `touchLease("running")` smoke call during tool execution (Bug B wiring)
- **`MockCopilotSdkAdapter` updated**: gains `onBeforeEvict` + `triggerBeforeEvict` to support Bug C test scenarios
- **Testability refactorings** (production code, minimal surface):
  - `DefaultCopilotSdkAdapter` exported from `session.ts` (was private)
  - `translateCopilotStream` gains optional flat params `idleTimeoutMs = 120_000` and `maxSilenceCount = 3` to replace hardcoded module constants

## Capabilities

### New Capabilities

- `copilot-lease-timeout-test-coverage`: test requirements for all three lease-timeout bugs and the DI cleanup regression guards

### Modified Capabilities

_(none — testability refactorings are implementation details, not spec-level behaviour changes)_

## Impact

- `src/bun/engine/copilot/session.ts` — export `DefaultCopilotSdkAdapter`
- `src/bun/engine/copilot/events.ts` — replace `IDLE_TIMEOUT_MS` / `MAX_SILENCE_COUNT` constants with function params (defaults unchanged)
- `src/bun/test/support/copilot-sdk-mock.ts` — add `onBeforeEvict`, `triggerBeforeEvict` to `MockCopilotSdkAdapter`
- New file: `src/bun/test/copilot-sdk-adapter.test.ts`
- Modified files: `src/bun/test/copilot-events.test.ts`, `src/bun/test/copilot-rpc-scenarios.test.ts`
- No API surface, RPC types, DB schema, or workflow YAML changes
