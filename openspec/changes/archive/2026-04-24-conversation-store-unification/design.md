## Context

Conversation state is split across `taskStore` and `chatStore`. Task chat owns the stream-tree implementation and context usage fetching, while session chat keeps only minimal token streaming state. This split duplicates logic, blocks parity, and creates correctness bugs because task-scoped and conversation-scoped identifiers are mixed in the same UI pipeline.

The system already has the raw ingredients for unification: stream events include `conversationId`, database rows already carry `conversation_id`, and both tasks and sessions ultimately render the same `ConversationBody`.

## Goals / Non-Goals

**Goals:**
- Introduce a single shared conversation-state owner keyed by `conversationId`
- Make conversation read APIs use `conversationId` as the primary identifier
- Preserve backward compatibility for DB schema and transitional task-keyed callers
- Decouple task-specific side effects from shared conversation mechanics
- Centralize conversation-scoped context usage and workspace-scoped model list ownership

**Non-Goals:**
- Remove legacy DB columns such as `task_id`
- Redesign task/session drawer shells
- Delete obsolete engine code (handled by `native-engine-removal`)

## Decisions

### 1. Use a singleton Pinia conversation store

**Decision:** Shared conversation mechanics will live in a singleton Pinia store rather than per-view composables.

**Rationale:** Stream events arrive globally through `App.vue`, not through individual drawer components. A singleton store can receive those events once and keep stream state alive even when the drawer closes.

### 2. Key shared state by conversationId

**Decision:** Stream state, message loading, active streaming identity, and context usage are keyed by `conversationId`.

**Rationale:** `conversationId` is the only identifier shared by tasks and sessions. Using it removes the taskId/conversationId namespace mismatch that causes cross-task stream contamination.

### 3. Keep backward-compatible handler aliases

**Decision:** Conversation RPCs will accept `conversationId` as the primary identifier and may continue accepting `taskId` as a compatibility alias during migration.

**Rationale:** The DB schema already contains the needed columns, but not every caller may move at once. Handler aliases let the runtime migrate without schema churn or forced cutovers.

### 4. Keep domain side effects out of the shared store

**Decision:** Task-specific side effects are triggered through hooks or subscriptions registered by `taskStore`, not by hard-coding task behavior into the shared conversation store.

**Rationale:** The shared store should own only conversation mechanics. File-diff refreshes, unread task markers, and other task concerns should stay in the task domain.

### 5. Move model-list ownership to workspace scope

**Decision:** Enabled/all model lists are treated as workspace-level state rather than task-owned state.

**Rationale:** Session chat already depends on the same model list, and model availability does not belong to any one task. Unifying ownership removes an accidental dependency on `taskStore`.

## Risks / Trade-offs

- **Store migration can break live streaming if callers split across old/new paths** → Mitigation: move `App.vue` event routing in one step and keep compatibility aliases in the backend.
- **Temporary duplication may exist while task/session stores delegate to the new store** → Mitigation: make the shared store the single owner of stream state and keep task/chat stores thin.
- **Handler alias support can prolong legacy usage** → Mitigation: capture follow-up cleanup tasks separately and keep the compatibility behavior explicit in design/tasks.
- **Hook registration can become implicit if scattered** → Mitigation: register hooks centrally during store initialization and keep the hook surface narrow.

## Migration Plan

1. Introduce the shared conversation store and `ConversationStreamState` types.
2. Add conversation-scoped handler support for message, stream-event, and context-usage reads, keeping taskId aliases.
3. Move `App.vue` stream/message routing to the shared conversation store.
4. Update `taskStore` and `chatStore` to delegate shared behavior and register hooks.
5. Move model list ownership to workspace-level state.
6. Leave DB cleanup and alias removal to a later change.

Rollback is straightforward: callers can return to the existing stores while DB schema remains unchanged.

## Open Questions

- Should unread session tracking also move into the shared conversation store eventually, or remain session-domain state because it is sidebar-specific?
- Should the shared store own optimistic user-message insertion directly, or should domain stores continue to initiate sends and then delegate reloads/state refreshes?
