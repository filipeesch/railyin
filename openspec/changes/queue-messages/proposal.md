## Why

When a task or chat session is running, the input is fully disabled — users cannot type or prepare a follow-up message while the assistant is working. This creates friction in multi-step workflows where the user already knows what they want to say next. Queued messages eliminate dead wait time and let users stay in flow.

## What Changes

- The conversation input editor becomes **enabled while the assistant is running** (no longer disabled)
- A new **queue button** (alongside the existing stop button) lets users enqueue a message for deferred send
- **Queue badge chips** appear above the editor showing pending messages with options to edit (✏) or cancel (✕)
- When the assistant turn ends, **all queued messages are batched into a single message** and sent automatically
- When answering an `ask_user_prompt` / `interview_me` widget, **queued messages are appended to the answer** in a single send
- Queued messages are **stored per-task / per-session** in their respective Pinia stores and survive drawer close/reopen
- If an execution fails or is cancelled, the queue is **preserved** (not discarded) so the user can still send or discard items
- Editing a queued chip **restores the raw text (with CodeMirror chip tokens) back into the editor** at the original queue position

## Capabilities

### New Capabilities

- `message-queue`: Queuing of follow-up messages during an active assistant turn, with FIFO batch drain, per-conversation isolation, edit-in-place, and interview-append behavior

### Modified Capabilities

- `conversation`: Input component gains queue state, queue button, and badge chip area — behavior when `executionState = running` changes from disabled to queue-enabled
- `chat-session`: Chat session store gains queue drain trigger on `stream.event done`
- `task`: Task store gains queue drain trigger on `stream.event done` and failure guard on `onTaskUpdated`

## Impact

- `src/mainview/components/ConversationInput.vue` — major changes to input row and new queue badge area
- `src/mainview/components/ChatEditor.vue` — no changes; `insert()` + `clear()` + `getValue()` exposed API reused for edit restore
- `src/mainview/stores/task.ts` — adds `taskQueues` map, `drainQueue`, `enqueueMessage`, `dequeueMessage`, `startEdit`, `confirmEdit` actions; extends `registerHooks` to drain on `done`
- `src/mainview/stores/chat.ts` — same queue actions as task store; extends `registerHooks` to drain on `done`
- `src/mainview/components/MessageBubble.vue` — `onAskSubmit` / `onInterviewSubmit` append queue to answer before sending
- New `e2e/ui/queue-messages.spec.ts` Playwright suite (Q-1 through Q-17, QS-1 through QS-6)
- No backend changes required — queue lives entirely on the frontend
