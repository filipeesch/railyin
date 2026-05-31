## Why

Chat sessions using the Pi engine silently fail to produce any AI response: the user sends a message, the session briefly shows "running", then returns to idle with no reply. This happens because `ChatExecutor` never injects `contextWindowOverride` into execution params — a value Pi requires at the model-build step — causing the engine to throw immediately before generating any output.

## What Changes

- Inject `ModelSettingsRepository` into `ChatExecutor` so it can look up the context window for the selected Pi model and pass `contextWindowOverride` into execution params
- Inject `IBoardToolExecutor` into `ChatExecutor` so board management tools (`get_task`, `list_tasks`, `create_task`, `move_task`, etc.) are available to Pi in chat sessions — consistent with task execution contexts
- Add a pre-flight check in `ChatExecutor.execute()`: if the engine is Pi and no context window is configured, persist an error system message into the conversation instead of silently failing, pointing the user to Model Settings
- Inject `onNewMessage: (msg: ConversationMessage) => void` into `ChatExecutor` so the pre-flight error message is immediately pushed via WebSocket — consistent with how `HumanTurnExecutor` handles `onTaskUpdated`
- Wire all new dependencies through `Orchestrator` (the only construction site for `ChatExecutor`)

## Capabilities

### New Capabilities
_(none — this is a bug fix, no new user-facing capabilities are introduced)_

### Modified Capabilities
- `chat-session`: ADD requirement — Pi engine must work correctly in chat sessions (contextWindowOverride must be resolved and board tools must be available); ADD requirement — when Pi context window is not configured, an error message must be shown in the conversation
- `pi-engine`: No spec-level requirement changes; the existing requirement that `buildModel` throws when `contextWindowOverride` is absent is already correct — it is the callers' responsibility to resolve and inject it

## Impact

- **Modified files**: `src/bun/engine/execution/chat-executor.ts`, `src/bun/engine/orchestrator.ts`
- **No interface changes**: `ExecutionParams.boardTools` and `ExecutionParams.contextWindowOverride` already exist; `ConversationMessage` is already a known type
- **No DB changes**
- **No RPC contract changes**
- **No frontend changes**
