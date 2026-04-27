## Context

Currently, `ConversationInput.vue` disables the CodeMirror editor and hides the send button while `executionState === "running"` (or `session.status === "running"`). Users cannot prepare follow-up messages during an active assistant turn, creating friction in multi-step workflows.

Both task and chat-session contexts share `ConversationInput.vue` and route through their respective Pinia stores (`task.ts`, `chat.ts`) for sending messages. Both stores already use `conversationStore.registerHooks()` to react to stream events — this is the unified trigger mechanism.

**Constraints:**
- No backend changes. `tasks.sendMessage` and `chatSessions.sendMessage` already accept the combined text.
- `ChatEditor.vue` exposes `clear()`, `insert(text)`, `getValue()` — sufficient for queue edit restore.
- CodeMirror 6 `chipDecorationPlugin` auto-renders chip tokens (`[/cmd|/cmd]`, `[#file|#file]`, `[@srv:tool|@tool]`) on any document update. Raw text restoration is automatic.

## Goals / Non-Goals

**Goals:**
- Enable message composition while assistant is running
- Queue multiple follow-up messages (FIFO), drained as one batched send
- Per-conversation isolation (task A's queue never affects task B)
- Queue survives drawer close/reopen
- Edit queued items with position preservation
- Append queue to interview answers (`ask_user_prompt` / `interview_me`)
- Unified trigger path for both task and chat-session contexts

**Non-Goals:**
- Backend queue persistence (queue is frontend-only, lost on page reload)
- Reordering queued items (drag-and-drop)
- Queue size limit (no cap imposed)
- Toast notifications on failure (existing "Failed" badge on task card is sufficient)

## Decisions

### D1: Queue state lives in each domain store, keyed by ID

**Decision:** `taskQueues: Map<taskId, QueueState>` in `task.ts`; `sessionQueues: Map<sessionId, QueueState>` in `chat.ts`.

**Rationale:** Queues must be isolated per conversation and survive component unmount. Pinia store state persists across drawer close/reopen, is reactive, and is co-located with `sendMessage`. A separate `useQueueStore` would require cross-store dependencies with no benefit.

**Alternatives considered:** Local `ref` in `ConversationInput.vue` — rejected because state is lost on unmount.

Data structure:
```ts
interface QueuedMessage {
  id: string            // crypto.randomUUID()
  text: string          // raw CM6 doc text (with chip tokens)
  engineText: string    // slash-prompt expanded at queue time
  attachments: Attachment[]
  addedAt: number
}

interface QueueState {
  items: QueuedMessage[]
  editingId: string | null    // ID of item currently loaded in editor
  editingIndex: number | null // original position for re-insertion
}
```

### D2: Unified drain trigger via `conversationStore.registerHooks`

**Decision:** Each store extends its existing `registerHooks` call to drain the queue on `stream.event type=done`.

Task store extends existing hook:
```
onStreamEvent(event):
  if type !== "done" or taskId == null → skip
  if task.executionState === "failed" or "cancelled" → skip (guard)
  → drainQueue(taskId)
```

Chat store extends existing onStreamEvent hook:
```
onStreamEvent(event):
  if type === "done" and taskId == null and conversationId != null
  → sessionId = sessionIdForConversation(conversationId)
  → drainQueue(sessionId)
```

**Rationale:** Both stores already have `registerHooks` wired up. The `done` event is the canonical end-of-turn signal for both contexts. No new store or watcher needed.

**Task failure guard:** `onTaskUpdated` already has `previous` (line 199 of task.ts). The drain checks `task.executionState` at drain time — if the task is already failed, skip drain.

**Chat sessions:** No "failed" status exists — drain always fires on `done`.

### D3: Batch drain — all queued messages joined into one send

**Decision:** When draining, join all queued messages into a single `sendMessage` call using `"\n\n---\n\n"` as separator. Queue is atomically cleared before the async send to prevent double-fire.

**Rationale:** One AI turn with full context is more efficient. FIFO one-by-one would require multiple round-trips.

**Alternatives considered:** FIFO one-per-turn — rejected due to latency and unnecessary round-trips.

### D4: Interview answer appends queue in single send

**Decision:** `MessageBubble.vue`'s `onAskSubmit` and `onInterviewSubmit` call a new `takeQueue(id)` action on the relevant store, then concatenate queue text to the answer before `sendMessage`. Queue is cleared atomically by `takeQueue`.

**Rationale:** Eliminates the `waiting_user` + queue interaction complexity. One send, AI sees full context.

### D5: Edit restores raw text to editor, preserves queue position

**Decision:**
1. `store.startEdit(id)` — records `editingId` + `editingIndex`; chip becomes ghost placeholder
2. `chatEditorRef.clear()` + `chatEditorRef.insert(item.text)` — CM6 auto-renders chip tokens as visual pills
3. Queue button label changes to "Update #N" while editing
4. On send: `store.confirmEdit(id, newText, newEngineText, attachments)` — `items.splice(editingIndex, 1, updated)`
5. ✕ on ghost chip: `store.cancelEdit()` — restores original item in place

**Rationale:** Reuses existing editor without new UI component. CM6 `chipDecorationPlugin` re-renders chip tokens automatically — no special restore path needed.

### D6: Queue chip shows raw text (what user typed), truncated to ~60 chars

**Rationale:** The raw text is what the user recognizes. The expanded `engineText` could be hundreds of lines — unreadable in a chip.

### D7: `waiting_user` — queue frozen, dispatched with interview answer

**Decision:** During `waiting_user`, chips display a frozen indicator (lock icon). Queue does NOT auto-drain. Queue is appended to the interview answer (D4) and cleared at that point.

**Rationale:** Prevents injecting queued messages mid-interview, which would corrupt the AI's expected answer flow.

## Risks / Trade-offs

- **Race condition: user manually sends while drain fires** → Drain empties the queue atomically before awaiting `sendMessage`. A manual send after drain cannot double-fire. [Low risk]

- **Queue lost on page reload** → Frontend-only queue is intentional. Users accept this for v1. [Known trade-off]

- **Batch join separator in AI context** → AI sees `\n\n---\n\n` separator lines between queued messages. Acceptable for markdown-aware models. [Low risk]

- **ConversationInput prop surface grows** → Mitigation: pass whole `QueueState` object + store action refs rather than individual items. [Manageable]

## Migration Plan

No migration required. Pure frontend addition. No backend or DB changes. Rollback by reverting frontend files — no persistent state to clean up.

## Open Questions

- **Separator string** `\n\n---\n\n`: works for markdown-aware models; not configurable in v1.
- **Queue badge DOM position**: above editor row, consistent with existing attachment chip area.
