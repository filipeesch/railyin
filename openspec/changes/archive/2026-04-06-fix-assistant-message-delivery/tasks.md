## 1. Engine — Add `onNewMessage` for final assistant messages

- [x] 1.1 Update happy path in `engine.ts`: capture return value of `appendMessage("assistant")` and call `onNewMessage` with the full message object
- [x] 1.2 Update `signal.aborted` mid-stream path: same pattern — capture ID, call `onNewMessage` after `appendMessage`
- [x] 1.3 Update `AbortError` catch path: call `onNewMessage` after `appendMessage` before calling `handleCancelled`
- [x] 1.4 Update general stream error catch path: call `onNewMessage` after `appendMessage` for the partial response

## 2. Frontend — Update streaming bubble replacement logic

- [x] 2.1 In `task.ts` `onNewMessage` handler: when `message.type === "assistant"` and `message.taskId === streamingTaskId.value`, clear `streamingToken` and `streamingTaskId` before pushing the real message
- [x] 2.2 In `task.ts` `onStreamToken(done)` handler: remove the `loadMessages` call — streaming state cleanup only, no DB refetch

## 3. Verification

- [x] 3.1 Run the app and confirm the assistant message appears immediately after streaming ends with no visual gap
- [x] 3.2 Confirm closing and reopening the drawer while streaming still shows the full message on reopen (DB fallback works)
- [x] 3.3 Confirm no duplicate messages appear when the drawer is open at the end of a stream
