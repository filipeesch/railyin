# Chat Optimistic Send Implementation Plan

## Overview

The current chat experience blocks the UI when sending messages. The user clicks "send", waits for the model response, and only then sees their own message in the chat. This creates a poor user experience.

We want to implement **optimistic message sending** where:
1. The user's message is immediately visible in the chat UI after clicking send
2. The message is shown with a "Sending..." or similar indicator
3. The actual message processing happens asynchronously in the background
4. Once the server confirms, the message is finalized

## Current Flow Analysis

### Frontend Components Involved:

1. **ConversationInput.vue** (`src/mainview/components/ConversationInput.vue`)
   - Contains the input field and send button
   - `onChatEditorSend()` is called when user clicks send
   - Currently calls `emit("send", ...)` which triggers task.store.sendMessage

2. **TaskStore** (`src/mainview/stores/task.ts`)
   - `sendMessage(taskId, content, engineContent, attachments)` is the key method
   - Currently awaits `api("tasks.sendMessage", ...)` which makes a RPC call to backend
   - Only after receiving the response does it call `conversationStore.appendMessage(message)`

3. **ConversationStore** (`src/mainview/stores/conversation.ts`)
   - Manages the message list and stream state
   - `appendMessage()` adds messages to the store
   - `onNewMessage()` handles new messages pushed from backend

4. **ConversationBody.vue** + **MessageBubble.vue**
   - Renders messages from the conversation store
   - Displays messages based on their type and state

### Backend Flow (`src/bun/handlers/tasks.ts`):

1. `tasks.sendMessage` RPC method
2. Creates an `executions` record with status='running'
3. Updates task's `execution_state = 'running'`
4. Calls `executeHumanTurn()` which:
   - Appends the user message to DB
   - Starts engine execution
   - Streams responses back
5. Returns `{ message, executionId }`

## Implementation Plan

### Phase 1: Optimistic Message Display (Frontend)

#### 1. Create Optimistic Message State

**File:** `src/mainview/stores/conversation.ts`

Add optimistic message tracking:
```typescript
// In ConversationStreamState
optimisticMessages: Map<string, {  // keyed by content hash or temp ID
  id: string;  // temp ID
  content: string;
  engineContent?: string;
  attachments?: Attachment[];
  createdAt: string;
}>;

// New function to add optimistic message
function addOptimisticMessage(
  conversationId: number,
  content: string,
  engineContent?: string,
  attachments?: Attachment[]
): string {  // returns temp ID
  // Create temp message with negative ID or UUID
  // Add to optimisticMessages map
  // Return temp ID for tracking
}

// New function to finalize optimistic message
function finalizeOptimisticMessage(
  conversationId: number,
  tempId: string,
  realMessage: ConversationMessage
) {
  // Replace optimistic message with real one
  // Remove from optimisticMessages map
}
```

#### 2. Modify TaskStore.sendMessage

**File:** `src/mainview/stores/task.ts`

```typescript
async function sendMessage(taskId: number, content: string, engineContent?: string, attachments?: Attachment[]) {
  const task = taskIndex.value[taskId];
  if (!task) return;

  // 1. Create optimistic message immediately
  const tempMessageId = conversationStore.addOptimisticMessage(
    task.conversationId,
    content,
    engineContent,
    attachments
  );

  // 2. Show a "Sending..." indicator in the UI (optional but nice)
  //    This can be done by checking for optimistic messages in MessageBubble

  // 3. Send to backend (non-blocking from UI perspective)
  try {
    const { message, executionId } = await api("tasks.sendMessage", {
      taskId,
      content,
      ...(engineContent != null ? { engineContent } : {}),
      ...(attachments?.length ? { attachments } : {}),
    });

    // 4. Finalize optimistic message with real server data
    conversationStore.finalizeOptimisticMessage(
      task.conversationId,
      tempMessageId,
      message
    );

    // The rest of current logic...
    if (message.conversationId !== conversationStore.activeConversationId) {
      conversationStore.setActiveConversation(message.conversationId);
      const task = taskIndex.value[taskId];
      if (task) taskIndex.value[taskId] = { ...task, conversationId: message.conversationId };
    }
    conversationStore.appendMessage(message);
  } catch (error) {
    // 5. Handle failure - remove or mark failed the optimistic message
    conversationStore.markOptimisticMessageFailed(task.conversationId, tempId, error);
    throw error;  // Re-throw to let caller handle
  }
}
```

#### 3. Update Message Rendering

**File:** `src/mainview/components/MessageBubble.vue`

Add visual feedback for optimistic messages:
```vue
<div v-else-if="chunk.type === 'user'" class="msg msg--user">
  <div class="msg__bubble prose" v-html="renderUserMd(displayContent)" />
  <div class="msg__meta">You</div>
  <i v-if="chunk.isOptimistic" class="pi pi-spinner pi-spin msg__optimistic-indicator" />
</div>
```

Style for the indicator:
```css
.msg__optimistic-indicator {
  font-size: 0.6rem;
  color: var(--p-text-muted-color);
  margin-left: 4px;
}
```

### Phase 2: Optimistic Message Display for Sessions

#### 4. Apply Same Pattern to Chat Sessions

**File:** `src/mainview/stores/chat.ts` (create if needed or extend)

Apply the same optimistic message pattern to chat sessions:
- `addOptimisticSessionMessage()`
- `finalizeSessionOptimisticMessage()`
- Modify `chatStore.sendMessage()` to use optimistic messages

### Phase 3: Backend Enhancements (Optional)

#### 5. Backend ACK Endpoint

**File:** `src/bun/handlers/conversations.ts`

Add a lightweight ACK endpoint that:
- Creates the conversation message immediately
- Returns the message ID
- Starts the execution asynchronously

This ensures the message exists in the DB even before the execution starts.

### Phase 4: Stream Handling

#### 6. Stream Integration

**File:** `src/mainview/stores/conversation.ts`

The existing `onStreamEvent()` and `onNewMessage()` should handle:
- Replacing optimistic messages with real ones when the stream arrives
- Merging stream chunks with the user message if needed

The key is ensuring `onNewMessage()` recognizes that a message with the same content already exists as an optimistic message and replaces it.

### Phase 5: Edge Cases

#### 7. Handle Message Updates

If the user edits or deletes an optimistic message:
- Update the optimistic message in the map
- If deleted, cancel any pending RPC calls

#### 8. Handle Multiple Messages in Queue

The existing queue system (`taskQueues`) should work with optimistic messages:
- Queued messages are already optimistic (waiting to send)
- Once dequeued, they become "sending" optimistic messages

## Implementation Steps

1. **Add optimistic message tracking to ConversationStore**
   - Add `optimisticMessages` Map
   - Add `addOptimisticMessage()` function
   - Add `finalizeOptimisticMessage()` function
   - Add `removeOptimisticMessage()` function

2. **Modify TaskStore.sendMessage**
   - Call `addOptimisticMessage()` before API call
   - Call `finalizeOptimisticMessage()` on success
   - Call `removeOptimisticMessage()` on failure

3. **Update ConversationBody to show optimistic state**
   - Pass optimistic message info to MessageBubble
   - Add visual indicator for "Sending..." state

4. **Update MessageBubble rendering**
   - Show spinner indicator for optimistic messages
   - Style adjustments for pending messages

5. **Apply same pattern to ChatStore**
   - If chat sessions have their own message store
   - Or modify `chatStore.sendMessage()` to use same approach

6. **Test edge cases**
   - Network failure during send
   - Message edited before sending
   - Multiple rapid messages
   - Queue + optimistic send interaction

## Benefits

1. **Instant UI feedback** - User sees their message immediately
2. **Better perceived performance** - No waiting for network round-trip
3. **Smooth streaming** - Message appears, then AI response streams in
4. **Robust error handling** - Failed messages can be marked and retried

## Considerations

1. **Message ID management**
   - Temp messages need unique IDs that don't conflict with server IDs
   - Use negative numbers or UUIDs for temp IDs

2. **Stream alignment**
   - Ensure the stream processor recognizes and merges with optimistic messages
   - Consider adding `optimisticMessageId` field to stream events

3. **Undo/Redo support**
   - Optimistic messages should be included in undo history
   - Consider adding "Undo send" for very recent messages

4. **Message ordering**
   - Optimistic messages should appear at the correct position
   - Handle race conditions if multiple messages are sent rapidly

## Estimated Files to Modify

1. `src/mainview/stores/conversation.ts` - Add optimistic message tracking
2. `src/mainview/stores/task.ts` - Update sendMessage with optimistic logic
3. `src/mainview/components/ConversationBody.vue` - Show optimistic state
4. `src/mainview/components/MessageBubble.vue` - Visual indicator
5. `src/mainview/stores/chat.ts` - Apply to chat sessions (if applicable)
