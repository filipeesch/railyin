## Why

The `pi-tool-loop-detection` change introduces `ToolLoopDetector` and wires it into both parent and child Pi sessions. This change adds the complete test suite for that feature — unit tests for the algorithm, integration tests for engine wiring, and targeted mock extensions to support testability without altering production paths.

## What Changes

- **New** `src/bun/test/pi/tool-loop-detector.test.ts` — 12 unit tests for `ToolLoopDetector` algorithm (ring buffer, fingerprinting, window eviction, cyclic detection)
- **New** `src/bun/test/pi/loop-detection-engine.test.ts` — 5 integration tests for `PiEngine` wiring (reset per execution, block event emission, detector identity across session reuse)
- **Extended** `src/bun/test/pi/delegate.test.ts` — 4 new tests (DL-15–DL-18) for child session loop guard via `buildDelegateTool`
- **Extended** `src/bun/test/pi-harness.test.ts` — 3 new tests (HLC-1–HLC-3) for `HarnessContext.loopDetector` initialization
- **Refactored** `MockBgSession.agent` in `background-compaction.test.ts` — add `beforeToolCall: undefined as any` slot (minimal, reflects real `Agent` type; existing BC tests unaffected)
- **Refactored** `MockChildSession.agent` in `delegate.test.ts` — add `beforeToolCall: undefined as any` slot + configurable call sequence for loop simulation

## Capabilities

### Modified Capabilities

- `pi-loop-detection`: Test coverage for all spec scenarios: same-tool loops, cyclic group loops, window eviction, reset between executions, block hint content, child session protection, independent detectors per child job
- `pi-tool-harness`: Test coverage for `HarnessContext.loopDetector` initialization and identity
- `pi-engine`: Test coverage for `beforeToolCall` wiring and reset-per-execution semantics

## Impact

- `src/bun/test/pi/tool-loop-detector.test.ts` — new file
- `src/bun/test/pi/loop-detection-engine.test.ts` — new file
- `src/bun/test/pi/delegate.test.ts` — extended (4 new tests + mock refactor)
- `src/bun/test/pi-harness.test.ts` — extended (3 new tests)
- `src/bun/test/pi/background-compaction.test.ts` — `MockBgSession.agent` shape extended
- No production code changes (mock-only refactors)
- No frontend changes, no API changes, no config schema changes
