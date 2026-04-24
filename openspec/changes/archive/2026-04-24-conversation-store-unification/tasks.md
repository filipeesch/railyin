## 1. Shared conversation store

- [x] 1.1 Introduce a singleton Pinia conversation store keyed by `conversationId`
- [x] 1.2 Rename shared stream-state types to `ConversationStreamState`
- [x] 1.3 Move stream-event accumulation and active streaming identity into the shared store

## 2. Shared routing and hooks

- [x] 2.1 Route stream tokens, stream events, stream errors, and new-message pushes through the shared conversation store in `App.vue`
- [x] 2.2 Add hook/subscription registration for task-specific side effects
- [x] 2.3 Delegate task unread/file-diff side effects through task-store subscriptions

## 3. Conversation-scoped APIs

- [x] 3.1 Update `conversations.getMessages` to use `conversationId` as the canonical key
- [x] 3.2 Update `conversations.getStreamEvents` to use `conversationId` as the canonical key
- [x] 3.3 Keep taskId compatibility aliases for migrating task callers
- [x] 3.4 Add conversation-scoped context usage retrieval

## 4. Store consumers

- [x] 4.1 Update `taskStore` to delegate shared message and stream state
- [x] 4.2 Update `chatStore` to delegate shared message and stream state
- [x] 4.3 Remove the session stream-event stub path

## 5. Workspace-level model ownership

- [x] 5.1 Move enabled/all model lists to workspace-level shared ownership
- [x] 5.2 Update task and session chat to read model availability from the shared workspace source

## 6. Validation

- [x] 6.1 Verify the cross-task streamed-message contamination bug is fixed by conversationId-keyed state
- [x] 6.2 Update automated coverage for shared-store routing and conversationId-based reads
