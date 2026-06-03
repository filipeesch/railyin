## Why

Local LLMs used through the Pi engine frequently get stuck calling the same tool (or cycling through a group of tools) with identical arguments indefinitely — a pattern common in smaller/quantized models. There is no automatic intervention, requiring manual user cancellation.

## What Changes

- **New** `ToolLoopDetector` class in `src/bun/engine/pi/harness/tool-loop-detector.ts` — sliding-window fingerprint tracker that detects both same-tool repetition and cyclic tool-group loops
- **Extended** `HarnessContext` interface with a `loopDetector: ToolLoopDetector` field
- **Wired** `session.agent.beforeToolCall` hook in both `createManagedExecution` (parent sessions) and `buildDelegateTool`'s per-job runner (child/delegate sessions) to run the detector on every tool call
- **Reset** detector at the start of each execution (`createManagedExecution`) since sessions are reused across turns
- Detection is **always enabled** — no config flag, no opt-in

## Capabilities

### New Capabilities

- `pi-loop-detection`: Stateful per-execution tool loop detector for Pi agent sessions. Tracks a sliding window of tool call fingerprints (toolName + normalized args), blocks repeated calls with a model-facing error hint, and resets between executions.

### Modified Capabilities

- `pi-tool-harness`: `HarnessContext` gains a new `loopDetector` field; `getOrCreateHarnessContext()` instantiates it.
- `pi-engine`: `createManagedExecution()` resets the detector and wires `beforeToolCall` on each execution.

## Impact

- `src/bun/engine/pi/harness/tool-loop-detector.ts` — new file
- `src/bun/engine/pi/harness/context.ts` — `loopDetector` field added to `HarnessContext`
- `src/bun/engine/pi/engine.ts` — `getOrCreateHarnessContext()` and `createManagedExecution()` updated
- `src/bun/engine/pi/tools/delegate.ts` — per-job runner wires `beforeToolCall` with a fresh detector after calling `childSessionFactory`; `defaultChildSessionFactory` stays pure
- No API changes, no config schema changes, no frontend changes
