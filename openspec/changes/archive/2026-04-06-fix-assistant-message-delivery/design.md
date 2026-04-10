## Context

The engine delivers messages to the frontend via two IPC channels:

1. **`onToken`** — streaming text tokens, driving the live "bubble" in the UI
2. **`onNewMessage`** — persisted message push for instant UI updates without a DB round-trip

Every message type written during execution (tool_call, tool_result, reasoning, file_diff, preamble) follows the same pattern:

```typescript
const id = appendMessage(taskId, conversationId, type, role, content);
onNewMessage({ id, taskId, conversationId, type, role, content, ... });
```

The final assistant message is the only exception. It only calls `appendMessage`, then relies on the `done` token signal to trigger `loadMessages` (a full DB refetch) in the frontend. This produces either:
- A visual gap: bubble clears, nothing shows until `loadMessages` completes two IPC round-trips later
- A duplicate message: if a previous failed execution left a stale assistant message, the next run's retry triggers `loadMessages` at the wrong time

The relevant engine locations:
- `engine.ts` line ~1526: happy path (successful generation)
- `engine.ts` line ~1499: `signal.aborted` mid-stream check  
- `engine.ts` line ~1122: `AbortError` in stream `catch`
- `engine.ts` line ~1131: general stream error `catch`

## Goals / Non-Goals

**Goals:**
- Make the final assistant message delivery consistent with all other message types (use `onNewMessage`)
- Eliminate the visual gap after streaming ends
- Remove the `loadMessages` call from the `done` signal handler
- Apply the fix to all 4 engine paths that write `appendMessage("assistant")`

**Non-Goals:**
- Fixing the `400: assistant prefill` error (history ending with assistant message) — separate issue
- Changing how any other message type is delivered
- Modifying the `onToken` streaming path

## Decisions

### Decision: Call `onNewMessage` after `appendMessage` for assistant messages

**Chosen**: After every `appendMessage(taskId, ..., "assistant", "assistant", clean)` in the engine, capture the returned row ID and immediately call `onNewMessage` with the full message object.

**Alternative considered**: Keep `loadMessages` in the done handler and just eliminate the optimistic push. This was the interim fix — it works but leaves a visual gap (two IPC round-trips: done signal → frontend calls `loadMessages` → bun fetches DB → returns to frontend).

**Rationale**: Consistent with how all other messages are delivered. The message is already written to DB before `onNewMessage` is called, so the DB is always the source of truth. `onNewMessage` is best-effort live push; drawer reopen always falls back to `loadMessages`.

### Decision: Frontend `onNewMessage` clears the streaming bubble for assistant messages

**Chosen**: In the `onNewMessage` handler in `task.ts`, when `message.type === "assistant"` and `message.taskId === streamingTaskId.value`, clear `streamingToken` and `streamingTaskId` (the bubble replacement signal) before pushing the real message.

**Why here and not in `onStreamToken(done)`**: The `done` signal is a transport-level event (token stream ended). The delivery of the persisted message is a separate concern. By handling bubble replacement in `onNewMessage`, the logic is co-located with the message arrival — the bubble disappears exactly when the real message arrives, with zero gap.

### Decision: Remove `loadMessages` from `onStreamToken(done)`

**Chosen**: The `done` handler only clears streaming state. No DB fetch.

**Fallback**: When the drawer is closed and reopened, `loadMessages` is still called normally. When `onNewMessage` is dropped (task not active), the DB load on reopen covers the message.

## Risks / Trade-offs

| Risk | Mitigation |
|---|---|
| `onNewMessage` dropped if drawer is closed | DB + `loadMessages` on drawer reopen is always the fallback — no data loss |
| Abort/error paths call `handleCancelled` immediately after, which may trigger task state update → `loadMessages` | Adding `onNewMessage` to abort paths ensures the message shows if the drawer is open, with no harm if the subsequent reload fetches it again (dedup by `id` prevents duplicates) |
| `appendMessage` return type must be usable as message `id` | `appendMessage` already returns `lastInsertRowid` (used for reasoning messages). The return type is already used at line ~1529 for session memory counting — no change needed to its signature |
