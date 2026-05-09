# Optimistic Message Send - Implementation Steps

This document provides step-by-step instructions for implementing optimistic message sending.

---

## Prerequisites

- Basic understanding of Vue 3 + Pinia stores
- Familiarity with the codebase structure
- Read `CHAT_OPTIMISTIC_SEND_DETAILED.md` for technical details

---

## Step 1: Update ConversationStore

**File:** `src/mainview/stores/conversation.ts`

### 1.1 Add optimistic message types

Add after the `StreamBlock` interface (around line 42):

```typescript
export interface OptimisticMessage {
  tempId: number;                    // Negative number as temp ID
  content: string;
  engineContent?: string;
  attachments?: Attachment[];
  createdAt: number;
}
```

### 1.2 Update ConversationStreamState interface

Update the interface (around line 50) to include optimistic messages:

```typescript
export interface ConversationStreamState {
  conversationId: number;
  executionId: number;
  roots: string[];
  blocks: Map<string, StreamBlock>;
  isDone: boolean;
  statusMessage: string;
  // NEW: Track optimistic (pending) messages
  optimisticMessages?: Map<number, OptimisticMessage>;
}
```

### 1.3 Add helper functions

Add after the existing store functions (before the `return` statement, around line 400):

```typescript
// Counter for generating unique temp IDs
let optimisticMessageCounter = 0;

function createOptimisticMessage(
  conversationId: number,
  content: string,
  engineContent?: string,
  attachments?: Attachment[]
): number {
  // Generate unique negative ID
  const tempId = -Date.now() - optimisticMessageCounter++;
  
  let state = streamStates.value.get(conversationId);
  if (!state) {
    state = {
      conversationId,
      executionId: 0,
      roots: [],
      blocks: new Map(),
      isDone: false,
      statusMessage: "",
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
  
  return tempId;
}

function finalizeOptimisticMessage(
  conversationId: number,
  tempId: number,
  realMessage: ConversationMessage
): void {
  const state = streamStates.value.get(conversationId);
  if (!state?.optimisticMessages) return;
  
  state.optimisticMessages.delete(tempId);
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

function hasOptimisticMessage(conversationId: number, content: string): boolean {
  const state = streamStates.value.get(conversationId);
  if (!state?.optimisticMessages) return false;
  
  return Array.from(state.optimisticMessages.values()).some(
    (msg) => msg.content === content
  );
}
```

### 1.4 Update onNewMessage to handle optimistic messages

Update the `onNewMessage` function (around line 390):

```typescript
function onNewMessage(message: ConversationMessage) {
  if (message.conversationId !== activeConversationId.value) return;
  
  // Check if this message corresponds to an optimistic message
  const streamState = streamStates.value.get(message.conversationId);
  if (streamState?.optimisticMessages) {
    // Find and remove optimistic message with matching content
    for (const [tempId, optMsg] of streamState.optimisticMessages.entries()) {
      if (optMsg.content === message.content) {
        streamState.optimisticMessages.delete(tempId);
        console.debug(`[conversation] Replaced optimistic message with real message ${message.id}`);
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

### 1.5 Update return statement

Update the return statement to expose the new functions:

```typescript
return {
  activeConversationId,
  messages,
  messagesLoading,
  hasMoreBefore,
  isLoadingOlder,
  streamStates,
  activeStreamState,
  contextUsage,
  contextUsageByConversation,
  setActiveConversation,
  appendMessage,
  loadMessages,
  loadOlderMessages,
  refreshLatestPage,
  fetchContextUsage,
  onStreamError,
  onStreamEvent,
  onNewMessage,
  // NEW: Optimistic message functions
  createOptimisticMessage,
  finalizeOptimisticMessage,
  removeOptimisticMessage,
  getOptimisticMessage,
  hasOptimisticMessage,
};
```

---

## Step 2: Update TaskStore

**File:** `src/mainview/stores/task.ts`

### 2.1 Modify sendMessage function

Update the `sendMessage` function (around line 200):

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
    console.error(`[taskStore] Failed to send message:`, error);
    throw error;
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

## Step 3: Update MessageBubble Component

**File:** `src/mainview/components/MessageBubble.vue`

### 3.1 Add optimistic indicator to template

Update the user message section (around line 25):

```vue
<div v-else-if="chunk.type === 'user'" class="msg msg--user">
  <div class="msg__bubble prose" v-html="renderUserMd(displayContent)" />
  <div class="msg__meta">
    You
    <i 
      v-if="isOptimisticMessage" 
      class="pi pi-spinner pi-spin msg__optimistic-indicator" 
      title="Sending..."
    />
  </div>
</div>
```

### 3.2 Add computed property for optimistic check

Add after `const isXmlToolCall` computed (around line 60):

```typescript
// NEW: Check if this message is an optimistic (pending) message
const isOptimisticMessage = computed(() => {
  // DB messages have positive IDs
  if (props.chunk.id >= 0) return false;
  
  // Check if this temp message exists in optimistic state
  const state = conversationStore.streamStates.value.get(props.chunk.conversationId);
  if (!state?.optimisticMessages) return false;
  
  return state.optimisticMessages.has(props.chunk.id);
});
```

### 3.3 Add CSS for optimistic indicator

Add after the existing `.msg__meta` CSS (around line 340):

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

## Step 4: Update Chat Store

**File:** `src/mainview/stores/chat.ts`

### 4.1 Add helper functions for session messages

Add after the existing helper functions (around line 200):

```typescript
// Counter for generating unique temp IDs for chat sessions
let optimisticSessionMessageCounter = 0;

function createOptimisticSessionMessage(
  sessionId: number,
  content: string,
  engineContent?: string,
  attachments?: Attachment[]
): number {
  // Generate unique negative ID
  const tempId = -Date.now() - optimisticSessionMessageCounter++;
  
  // We store session optimistic messages in conversation store
  // using the conversationId from the session
  const conversationId = sessions.value.find(s => s.id === sessionId)?.conversationId;
  if (conversationId == null) return tempId; // Return tempId even if conversation not found
  
  const state = conversationStore.streamStates.value.get(conversationId);
  if (!state) {
    return tempId; // Can't create optimistic message without stream state
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
  
  return tempId;
}

function finalizeOptimisticSessionMessage(
  sessionId: number,
  tempId: number
): void {
  const conversationId = sessions.value.find(s => s.id === sessionId)?.conversationId;
  if (conversationId == null) return;
  
  conversationStore.finalizeOptimisticMessage(conversationId, tempId, {
    id: tempId, // Dummy - won't be used
    taskId: null,
    conversationId,
    type: "user",
    role: "user",
    content: "",
    metadata: null,
    createdAt: new Date().toISOString(),
  });
}

function removeOptimisticSessionMessage(
  sessionId: number,
  tempId: number
): void {
  const conversationId = sessions.value.find(s => s.id === sessionId)?.conversationId;
  if (conversationId == null) return;
  
  conversationStore.removeOptimisticMessage(conversationId, tempId);
}
```

### 4.2 Update sendMessage function

Update the `sendMessage` function (around line 180):

```typescript
async function sendMessage(content: string, engineContent?: string, attachments?: import("@shared/rpc-types").Attachment[], model?: string | null) {
  if (!activeChatSessionId.value) return;
  const session = activeSession.value;
  if (!session) return;
  
  // 1. Create optimistic message
  const tempMessageId = createOptimisticSessionMessage(
    session.id,
    content,
    engineContent,
    attachments
  );
  
  const now = new Date().toISOString();
  updateSession(session.id, {
    status: "running",
    lastActivityAt: now,
    lastReadAt: now,
  });
  
  // 2. Make RPC call
  try {
    await api("chatSessions.sendMessage", {
      sessionId: activeChatSessionId.value,
      content,
      ...(engineContent != null ? { engineContent } : {}),
      model,
      ...(attachments?.length ? { attachments } : {}),
    });
    
    // 3. Finalize optimistic message
    finalizeOptimisticSessionMessage(session.id, tempMessageId);
  } catch (error) {
    // 4. On failure, remove optimistic message
    removeOptimisticSessionMessage(session.id, tempMessageId);
    console.error(`[chatStore] Failed to send message:`, error);
    throw error;
  }
}
```

---

## Step 5: Test the Implementation

### Test Cases

1. **Basic optimistic send:**
   - User types message and clicks send
   - Message appears immediately in chat
   - "Sending..." spinner is visible
   - After backend ACK, spinner disappears

2. **Network failure:**
   - User sends message
   - Simulate network failure
   - Message shows error state
   - User can retry

3. **Multiple rapid messages:**
   - User sends 3 messages in quick succession
   - All messages appear immediately
   - No ID conflicts
   - Messages appear in correct order

4. **Message replacement:**
   - User sends message
   - Backend sends real message with same content
   - Optimistic message is replaced
   - No duplicates

---

## Troubleshooting

### Issue: Messages appearing twice

**Cause:** The real message is being added twice - once from optimistic, once from `onNewMessage`.

**Solution:** The `onNewMessage` function should detect and skip duplicates based on content matching. Verify the content comparison is working.

### Issue: Optimistic message not being replaced

**Cause:** Content comparison might be failing due to whitespace or formatting differences.

**Solution:** Normalize content before comparison:
```typescript
const normalizedOptimistic = optMsg.content.trim().replace(/\s+/g, ' ');
const normalizedReal = message.content.trim().replace(/\s+/g, ' ');
return normalizedOptimistic === normalizedReal;
```

### Issue: UI flickering

**Cause:** Vue reactivity is causing unnecessary re-renders.

**Solution:** Ensure we're only updating the optimistic messages map, not the messages array until the real message arrives.

---

## Performance Considerations

### Memory Usage

- Optimistic messages are stored in memory only (Map)
- They are cleaned up when finalized or removed
- No persistence needed for MVP

### ID Generation

- Using `-Date.now() - counter` ensures uniqueness
- Negative numbers avoid conflicts with DB IDs
- Counter handles same-millisecond scenarios

### Cleanup

- Finalized messages are removed from optimistic map
- Failed messages can be cleaned up after timeout
- Consider periodic cleanup of old optimistic messages

---

## Future Enhancements

1. **Persist optimistic messages to localStorage**
   - Handles page refresh during send
   - Requires additional cleanup logic

2. **Add "Undo send" for recent messages**
   - Allow user to retract message before backend ACK
   - Cancel pending RPC call if possible

3. **Batch multiple optimistic messages**
   - Queue system already handles this
   - Ensure proper ordering

4. **Show send progress indicator**
   - Instead of spinner, show "X/3 messages sent"
   - Better UX for batch operations

---

## Summary

The implementation adds optimistic message sending by:

1. Creating a temporary message ID before the RPC call
2. Displaying the message immediately with a "Sending..." indicator
3. Finalizing the message when the backend ACK arrives
4. Handling failures gracefully by removing the optimistic message

The key insight is that the `onNewMessage` handler can match optimistic messages by content and replace them with the real server-generated messages.
