## Why

Conversation state is currently split between `taskStore` and `chatStore`, with task chat using task-scoped stream state and session chat using a reduced path. That split leaves duplicated logic, prevents feature parity, and has already produced bugs like streamed content leaking into the wrong drawer because task IDs and conversation IDs are mixed.

## What Changes

- Introduce a shared conversation state layer keyed by `conversationId`, used by both task chat and session chat.
- Make `conversationId` the primary API handle for conversation reads and stream-state lookups, while keeping `taskId` aliases where needed for backward-compatible migration.
- Move shared message loading, structured stream-state accumulation, and context-usage fetching behind conversation-scoped APIs.
- Let task-specific side effects subscribe via hooks instead of embedding conversation mechanics inside `taskStore`.
- Move workspace-scoped model list ownership out of task-only state so both chat modes depend on the same source.

## Capabilities

### New Capabilities
- `conversation-state`: Shared conversation state management keyed by `conversationId`, reusable across task and standalone session chat

### Modified Capabilities
- `conversation`: Clarify that conversation read/query paths are keyed by `conversationId`, with compatibility aliases only for migration
- `context-gauge`: Move context usage retrieval to conversation-scoped APIs so the same behavior applies in task and session chat
- `model-selection`: Clarify that enabled model lists are shared workspace-level data surfaced consistently in both task and session chat

## Impact

- Frontend stores: new shared conversation store/composable, slimmer `taskStore`, richer `chatStore`
- Frontend wiring: `App.vue`, `TaskChatView.vue`, `SessionChatView.vue`, `ConversationPanel.vue`, `ConversationBody.vue`
- Backend APIs: `conversations.getMessages`, `conversations.getStreamEvents`, context usage endpoint shape, RPC typings
- Migration safety: no destructive DB cleanup in this change; retain legacy columns and aliases while moving callers to `conversationId`
