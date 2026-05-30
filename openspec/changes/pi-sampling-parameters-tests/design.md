## Context

The `pi-sampling-parameters` change introduces:
1. `resolveSamplingPreset()` — a pure function in `src/bun/engine/pi/sampling-params.ts`
2. `_applyPresetToSession(session, presetName?)` — a private helper extracted from `createManagedExecution()`
3. `ExecutionParams.samplingPresetName?: string` — preset name threaded through params
4. Config type extensions on `PiEngineConfig` and `WorkflowColumnConfig`

The test strategy is layer-by-layer, from pure units outward to integration. The key design constraint is that `createManagedExecution` is a private async generator — testing the `onPayload` wiring by driving it end-to-end is impractical. The `_applyPresetToSession` extraction creates the explicit test seam.

**Session reuse leakage** is the most critical correctness risk: a Pi session is reused across executions (keyed by `conversationId`). If `_applyPresetToSession` fails to clear `onPayload` when no preset resolves, the prior execution's sampling values silently bleed into the next execution.

## Goals / Non-Goals

**Goals:**
- Full unit coverage of `resolveSamplingPreset()` including edge cases (`temperature: 0`, missing map, unknown preset name)
- Unit coverage of `_applyPresetToSession()` via bracket notation, consistent with existing test patterns
- Integration coverage of `samplingPresetName` flowing through `TransitionExecutor` → `ExecutionParams`
- Config parsing coverage for new YAML fields on engine and column configs
- Regression test for session-reuse leakage (`PE-PRESET-5`)

**Non-Goals:**
- Playwright/E2E tests (no UI surface)
- Testing the Pi SDK's actual `onPayload` invocation against a real or faux LLM (the SDK is not under test here; the faux provider does not make HTTP requests so `onPayload` would never fire)
- Testing other engines' behavior with `samplingPresetName` beyond confirming they ignore it

## Decisions

### Decision: Test `_applyPresetToSession` via bracket notation, not by driving `execute()`

**Chosen**: `(engine as any)._applyPresetToSession(session, presetName)` called directly in tests.

**Rationale**: Consistent with `simulateGetOrCreate` and `(engine as any).sessions` access already established in `pi-engine.test.ts`. Driving the full `execute()` generator to test one side-effect would require wiring a complete `ExecutionParams`, a real or mock stream processor, and handling async generator lifecycle — disproportionate complexity for testing one assignment.

### Decision: `filterDefined` uses strict `!== undefined` check

**Rationale**: Sampling values of `0` (e.g. `temperature: 0`) are valid and must not be filtered. Using truthiness (`!value`) would silently drop them. PS-10 is the canonical regression test for this.

### Decision: Add `onPayload?: (payload: unknown, model: unknown) => unknown` to `MockAgentSession.agent`

**Rationale**: `MockAgentSession` currently only has `state` on its `agent` stub. Extending it with `onPayload` mirrors the real `Agent` interface and lets `PE-PRESET-*` tests assert assignment without importing the Pi SDK in test infrastructure.

## Risks / Trade-offs

- **[Risk] _applyPresetToSession is private** → Bracket notation (`(engine as any)`) is the accepted pattern in this codebase. Tests remain valid as long as the method exists; a rename would break the test, which is acceptable as a compile-time signal.
- **[Trade-off] No live HTTP verification of onPayload** → The faux provider doesn't invoke `onPayload` (no HTTP). We verify the *wiring* (is `onPayload` set correctly?) not the *LLM behavior*. This is the right boundary — the SDK's execution of `onPayload` is its own responsibility.

## Migration Plan

Tests are additive. No production code changes in this change. Run after `pi-sampling-parameters` is implemented:
```
bun test src/bun/test --timeout 20000
```

## Open Questions

None.
