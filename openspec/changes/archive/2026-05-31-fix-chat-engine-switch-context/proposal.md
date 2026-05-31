## Why

When a user switches engine/model mid-conversation in a chat session, the new engine starts with an empty context — it has no knowledge of what was discussed before. The `CrossEngineContextInjector` already solves this for task executors (`TransitionExecutor`, `HumanTurnExecutor`), but `ChatExecutor` was never wired up to use it.

## What Changes

- `ChatExecutor` gains a `CrossEngineContextInjector` constructor dependency and calls `prepareSwitch()` before each execution, injecting the conversation history block into the engine prompt when an engine switch is detected.
- `ChatExecutor` writes `conversations.last_engine_type` after each turn so future switch detection is accurate.
- `ChatExecutor` resolves the source engine from `conversations.last_engine_type` (via `engineRegistry.getEngineById()`) to enable pre-switch compaction when context is large.
- `Orchestrator` passes a `CrossEngineContextInjector` instance when constructing `ChatExecutor`.
- The misleading model-update condition in `ChatExecutor` (`if (!modelValue)`) is corrected to always sync the model when it changes.

## Capabilities

### New Capabilities
- none

### Modified Capabilities
- `cross-engine-context-injection`: Extend coverage to chat sessions — `ChatExecutor` must call `prepareSwitch()` and maintain `last_engine_type` exactly as task executors do. The existing requirements are unchanged; chat sessions are a new execution path that must satisfy the same invariants.

## Impact

- **`src/bun/engine/execution/chat-executor.ts`** — add `crossEngineInjector` dependency, `prepareSwitch()` call, `last_engine_type` write, model-update fix.
- **`src/bun/engine/orchestrator.ts`** — pass `new CrossEngineContextInjector(db)` when constructing `ChatExecutor`.
- No API changes, no DB migrations, no frontend changes.
- Existing task executor behavior is unaffected.
