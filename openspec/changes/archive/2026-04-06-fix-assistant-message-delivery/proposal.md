## Why

The final assistant message in the chat UI is delivered via a different path than all other message types (tool_call, tool_result, reasoning, file_diff, etc.), causing a visual gap after streaming ends and potential duplicate messages when the engine retries. All other messages use `appendMessage + onNewMessage` for instant push; the final assistant message uses `appendMessage + done-signal + loadMessages`, requiring two extra IPC round-trips and a full DB refetch.

## What Changes

- The engine SHALL call `onNewMessage` for the final assistant message immediately after `appendMessage`, consistent with all other message types.
- The frontend `onStreamToken(done)` handler SHALL stop calling `loadMessages` — the message is already delivered via `onNewMessage`.
- The frontend `onNewMessage` handler SHALL recognize an incoming assistant message that matches the current streaming task and clear the streaming bubble, replacing it with the persisted message.
- This applies to all paths in the engine that write a final assistant message: happy path, abort catch, stream error catch.

## Capabilities

### New Capabilities

_(none — this is a bug fix)_

### Modified Capabilities

- `conversation`: The requirement for how the final assistant message is delivered to the frontend changes. The spec currently says the response is persisted before the done signal; it must now also specify that the engine delivers the final assistant message via the real-time `onNewMessage` push (not via a post-done DB reload).

## Impact

- `src/bun/workflow/engine.ts` — all locations that call `appendMessage(taskId, ..., "assistant", ...)` for the final response must also call `onNewMessage`
- `src/mainview/stores/task.ts` — `onStreamToken(done)` must not call `loadMessages`; `onNewMessage` must handle the assistant bubble replacement
