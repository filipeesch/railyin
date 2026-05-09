# Chat Optimistic Send - Detailed Implementation Plan

## Overview

Implement **optimistic message sending** where user messages appear immediately in the chat UI after clicking send, rather than waiting for server round-trip.

---

## Architecture

### Data Flow (Current vs Optimistic)

```
CURRENT FLOW:
User clicks send → RPC call (blocks) → Backend processes → Message appears

OPTIMISTIC FLOW:
User clicks send → Create temp message → Message appears IMMEDIATELY
                                    ↓
                              RPC call (async)
                                    ↓
                              Backend processes
                                    ↓
                              Real message arrives → Replace temp message
```

---

## Implementation Steps

### Step 1: Update ConversationStore (conversation.ts)

**File:** `src/mainview/stores/conversation.ts`

#### Add optimistic message tracking to ConversationStreamState:

```typescript
export interface ConversationStreamState {
  conversationId: number;
  executionId: number;
  roots: string[];
  blocks: Map<string, StreamBlock>;
  isDone: boolean;
  statusMessage: string;
  // NEW: Track optimistic (pending) messages
  optimisticMessages: Map<number, OptimisticMessage>;
}

export interface OptimisticMessage {
  tempId: number;                    // Negative number as temp ID
  content: string;
  engineContent?: string;
  attachments?: Attachment[];
  createdAt: number;                 // Timestamp for cleanup
}
```

#### Add helper functions to the store:

```typescript
// Add after the store definition, before return statement

const optimisticMessageCounter = ref(0);

function createOptimisticMessage(
  conversationId: number,
  content: string,
  engineContent?: string,
  attachments?: Attachment[]
): number {
  // Generate unique negative ID (negative to avoid DB ID conflicts)
  const tempId = -Date.now() - optimisticMessageCounter.value++;
  
  let state = streamStates.value.get(conversationId);
  if (!state) {
    state = {
      conversationId,
      executionId: 0,
      roots: [],
      blocks: new Map(),
      isDone: false,
      statusMessage: "",
      optimisticMessages: new Map(),
    };
    streamStates.value.set(conversationId, state);
  }
  
  if (!state.optimisticMessages) {
    state.optimisticMessages = new Map();
  }
  
  state.optimisticMessages.set(tempId, {
    tempId,
    content,
    engineContent,
    attachments,
    createdAt: Date.now(),
  });
  
  // Return temp ID for tracking
  return tempId;
}

function finalizeOptimisticMessage(
  conversationId: number,
  tempId: number,
  realMessage: ConversationMessage
): void {
  const state = streamStates.value.get(conversationId);
  if (!state?.optimisticMessages) return;
  
  // Remove the optimistic message from the map
  state.optimisticMessages.delete(tempId);
  
  // The real message will be added via appendMessage/onNewMessage
}

function removeOptimisticMessage(
  conversationId: number,
  tempId: number
): void {
  const state = streamStates.value.get(conversationId);
  if (!state?.optimisticMessages) return;
  
  state.optimisticMessages.delete(tempId);
}

function getOptimisticMessage(
  conversationId: number,
  tempId: number
): OptimisticMessage | undefined {
  return streamStates.value.get(conversationId)?.optimisticMessages?.get(tempId);
}
```

#### Modify onNewMessage to check for optimistic messages:

```typescript
function onNewMessage(message: ConversationMessage) {
  if (message.conversationId !== activeConversationId.value) return;
  
  // Check if this message corresponds to an optimistic message
  const streamState = streamStates.value.get(message.conversationId);
  if (streamState?.optimisticMessages) {
    // Find optimistic message with matching content
    for (const [tempId, optMsg] of streamState.optimisticMessages.entries()) {
      if (optMsg.content === message.content) {
        // This is the real version of an optimistic message
        streamState.optimisticMessages.delete(tempId);
        break;
      }
    }
  }
  
  // Only skip appending if there's an active stream and this is NOT a user message
  if (streamState && !streamState.isDone && message.type !== "user") {
    console.debug("[conversation] onNewMessage DROPPED (stream not done)", message.type, message.id);
    return;
  }
  if (messages.value.some((entry) => entry.id === message.id)) return;
  console.debug("[conversation] onNewMessage ACCEPTED", message.type, message.id);
  messages.value.push(message);
  sortMessagesInPlace();
}
```

#### Update return statement to expose new functions:

```typescript
return {
  // ... existing exports
  createOptimisticMessage,
  finalizeOptimisticMessage,
  removeOptimisticMessage,
  getOptimisticMessage,
};
```

---

### Step 2: Update TaskStore (task.ts)

**File:** `src/mainview/stores/task.ts`

#### Modify sendMessage to use optimistic messages:

```typescript
async function sendMessage(taskId: number, content: string, engineContent?: string, attachments?: import("@shared/rpc-types").Attachment[]) {
  const task = taskIndex.value[taskId];
  if (!task) return;
  
  // 1. Create optimistic message IMMEDIATELY (before RPC call)
  const tempMessageId = conversationStore.createOptimisticMessage(
    task.conversationId,
    content,
    engineContent,
    attachments
  );
  
  // 2. Make RPC call asynchronously
  let message: ConversationMessage;
  try {
    const result = await api("tasks.sendMessage", {
      taskId,
      content,
      ...(engineContent != null ? { engineContent } : {}),
      ...(attachments?.length ? { attachments } : {}),
    });
    message = result.message;
  } catch (error) {
    // 3. On failure, remove optimistic message and show error
    conversationStore.removeOptimisticMessage(task.conversationId, tempMessageId);
    throw error;  // Re-throw for error handling
  }
  
  // 4. On success, finalize optimistic message
  conversationStore.finalizeOptimisticMessage(
    task.conversationId,
    tempMessageId,
    message
  );
  
  // 5. Sync conversation ID if needed (existing logic)
  if (message.conversationId !== conversationStore.activeConversationId) {
    conversationStore.setActiveConversation(message.conversationId);
    const taskInIndex = taskIndex.value[taskId];
    if (taskInIndex) {
      taskIndex.value[taskId] = { ...taskInIndex, conversationId: message.conversationId };
    }
  }
  
  // 6. Append the real message
  conversationStore.appendMessage(message);
}
```

---

### Step 3: Update MessageBubble Component

**File:** `src/mainview/components/MessageBubble.vue`

#### Add optimistic indicator:

```vue
<div v-else-if="chunk.type === 'user'" class="msg msg--user">
  <div class="msg__bubble prose" v-html="renderUserMd(displayContent)" />
  <div class="msg__meta">
    You
    <i 
      v-if="isOptimisticMessage(chunk)" 
      class="pi pi-spinner pi-spin msg__optimistic-indicator" 
      title="Sending..."
    />
  </div>
</div>
```

#### Add helper function in setup:

```typescript
// Add after computed displayContent
const conversationStore = useConversationStore();
const props = defineProps<{
  chunk: ConversationMessage;
  index?: number;
}>();

// NEW: Check if message is optimistic
const isOptimisticMessage = (chunk: ConversationMessage) => {
  if (chunk.id >= 0) return false;  // DB messages have positive IDs
  
  // Check if this temp message exists in optimistic state
  const state = conversationStore.streamStates.value.get(chunk.conversationId);
  if (!state?.optimisticMessages) return false;
  
  return Array.from(state.optimisticMessages.values()).some(
    (msg) => msg.tempId === chunk.id
  );
};
```

#### Add CSS for optimistic indicator:

```css
.msg__optimistic-indicator {
  font-size: 0.6rem;
  color: var(--p-text-muted-color);
  margin-left: 4px;
}

.msg--user .msg__optimistic-indicator {
  color: var(--p-primary-600);
}
```

---

### Step 4: Handle Message Replacement

The key insight is that `onNewMessage` will be called when the backend sends back the real message. We need to ensure the optimistic message is replaced properly.

The current `onNewMessage` already has logic to skip duplicates. We need to modify it to:

1. Detect if the incoming message replaces an optimistic message
2. Remove the optimistic message from the map
3. Add the real message to the store

The implementation in Step 1 already handles this by comparing content.

**Alternative approach (more robust):** Store a reference to the optimistic message in the stream state alongside the real message ID.

---

### Step 5: Update Chat Sessions (if applicable)

**File:** `src/mainview/stores/chat.ts`

If chat sessions use a similar pattern, apply the same optimistic message logic:

```typescript
async function sendMessage(
  content: string,
  engineContent?: string,
  attachments?: Attachment[]
) {
  const sessionId = activeChatSessionId.value;
  if (sessionId == null) return;
  
  // Create optimistic message
  const tempMessageId = createOptimisticSessionMessage(
    sessionId,
    content,
    engineContent,
    attachments
  );
  
  try {
    const result = await api("conversations.sendMessage", {
      sessionId,
      content,
      ...(engineContent != null ? { engineContent } : {}),
      ...(attachments?.length ? { attachments } : {}),
    });
    
    finalizeOptimisticSessionMessage(sessionId, tempMessageId, result.message);
    appendSessionMessage(result.message);
  } catch (error) {
    removeOptimisticSessionMessage(sessionId, tempMessageId);
    throw error;
  }
}
```

---

## Technical Details

### Message ID Strategy

**Why negative numbers?**
- DB auto-increment IDs are always positive
- Negative numbers guarantee no conflicts
- Simple to check: `message.id < 0` for optimistic

**Alternative: UUIDs**
- More robust but requires string comparisons
- Useful if you need IDs before any RPC call

### Stream Alignment

The stream processor receives events from the backend. We need to ensure:

1. **Stream events reference the temp message ID** if possible
2. **Real message ID is set in stream events** when available

Current stream events:
```typescript
export interface StreamEvent {
  type: StreamEventType;
  conversationId: number;
  executionId: number;
  blockId?: string;
  parentBlockId?: string;
  content?: string;
  seq?: number;
  // ... other fields
}
```

We might want to add:
```typescript
optimisticMessageId?: number;  // Reference to optimistic message
```

But this isn't strictly necessary - the content matching approach in Step 1 works fine.

---

## Edge Cases

### 1. Network Failure

**Current behavior:** Error is thrown, optimistic message is removed.

**Enhancement:** Mark as "failed" and allow retry.

```typescript
function markOptimisticMessageFailed(
  conversationId: number,
  tempId: number,
  error: Error
): void {
  const state = streamStates.value.get(conversationId);
  if (!state?.optimisticMessages) return;
  
  const msg = state.optimisticMessages.get(tempId);
  if (msg) {
    state.optimisticMessages.set(tempId, {
      ...msg,
      error: error.message,
      failed: true,
    });
  }
}
```

### 2. Multiple Messages in Quick Succession

The optimistic message counter ensures unique IDs:

```typescript
const optimisticMessageCounter = ref(0);

const tempId = -Date.now() - optimisticMessageCounter.value++;
```

Even if two messages are sent in the same millisecond, the counter ensures uniqueness.

### 3. MessageEdited Before Sending

If user edits message before backend ACK:

**Current flow:**
1. User types "Hello"
2. Clicks send → optimistic message created
3. User realizes typo, edits input
4. User clicks send again

**Expected behavior:**
- Second send should replace the first optimistic message
- Or queue both messages

This is already handled by the queue system if we're running.

### 4. Page Refresh During Send

**Scenario:** User sends message, page refreshes before backend ACK.

**Behavior:**
- Optimistic message is lost (it's in memory only)
- Real message arrives after refresh
- `onNewMessage` adds the real message

**Enhancement:** Persist optimistic messages to localStorage:

```typescript
function persistOptimisticMessages() {
  const data = Object.fromEntries(optimisticMessagesMap);
  localStorage.setItem('optimisticMessages', JSON.stringify(data));
}

function restoreOptimisticMessages() {
  const data = localStorage.getItem('optimisticMessages');
  if (data) {
    optimisticMessagesMap = new Map(Object.entries(JSON.parse(data)));
  }
}
```

But this adds complexity. For MVP, lost optimistic messages on refresh is acceptable.

---

## Testing Strategy

### Unit Tests

```typescript
// conversation.test.ts
describe('optimistic messages', () => {
  test('creates optimistic message', () => {
    const tempId = createOptimisticMessage(1, 'Hello');
    expect(tempId).toBeLessThan(0);
    expect(getOptimisticMessage(1, tempId)?.content).toBe('Hello');
  });
  
  test('finalizes optimistic message', () => {
    const tempId = createOptimisticMessage(1, 'Hello');
    finalizeOptimisticMessage(1, tempId, {
      id: 123,  // Real ID
      taskId: null,
      conversationId: 1,
      type: 'user',
      role: 'user',
      content: 'Hello',
      metadata: null,
      createdAt: new Date().toISOString(),
    });
    expect(getOptimisticMessage(1, tempId)).toBeUndefined();
  });
  
  test('replaces optimistic message on real message', () => {
    const tempId = createOptimisticMessage(1, 'Hello');
    const realMessage = { /* ... */ };
    onNewMessage(realMessage);
    expect(getOptimisticMessage(1, tempId)).toBeUndefined();
    expect(messages.value.some(m => m.id === 123)).toBe(true);
  });
});
```

### Integration Tests

1. Send message → message appears immediately
2. Message shows "Sending..." indicator
3. Backend ACK arrives → indicator disappears
4. Network failure → message shows error
5. Retry → new optimistic message created

---

## Migration Path

### Phase 1: Core Optimistic Send (MVP)
1. Add optimistic message tracking to ConversationStore
2. Update TaskStore.sendMessage
3. Add visual indicator in MessageBubble
4. Test with task chat

### Phase 2: Chat Session Support
1. Apply same pattern to chat sessions
2. Test with conversation drawer

### Phase 3: Error Handling
1. Add failed state indication
2. Add retry mechanism
3. Add undo/redo for pending messages

### Phase 4: Advanced Features
1. Persist optimistic messages to localStorage
2. Handle page refresh gracefully
3. Queue + optimistic send integration

---

## Files to Modify Summary

| File | Changes | Lines |
|------|---------|-------|
| `src/mainview/stores/conversation.ts` | Add optimistic message tracking | ~80 lines |
| `src/mainview/stores/task.ts` | Update sendMessage logic | ~30 lines |
| `src/mainview/components/MessageBubble.vue` | Add optimistic indicator | ~15 lines |
| `src/mainview/stores/chat.ts` | Apply to sessions | ~50 lines (if needed) |

**Total estimated changes:** ~175 lines of code

---

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Message duplication | Medium | Content-based matching in `onNewMessage` |
| ID conflicts | Low | Negative IDs guaranteed no conflict |
| Stream misalignment | Low | Content matching fallback |
| Memory leak | Low | Cleanup on finalize/replace |
| State inconsistency | Medium | Simple state model, easy to debug |

---

## Success Criteria

1. User clicks send, message appears in chat within 50ms (vs current 500ms+)
2. "Sending..." indicator visible during RPC round-trip
3. Once real message arrives, indicator disappears seamlessly
4. Network failure handled gracefully with error state
5. No duplicate messages in conversation
6. No UI flickering or unexpected message reordering
