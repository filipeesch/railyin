## Context

Several backend code paths that call `onTaskUpdated()` or `onSessionUpdated()` use bare `SELECT * FROM tasks` or `SELECT * FROM chat_sessions` queries that do not JOIN the `conversations` table. The `mapTask()` and `mapChatSession()` mappers read `row.conversation_model ?? null` — a column that only exists when the join is present. When the join is absent the column is `undefined`, coercing to `null`, and the resulting `Task.model: null` is broadcast via WebSocket. The frontend `_replaceTask()` and `onChatSessionUpdated()` blindly replace the store entry, causing `ConversationInput`'s fallback `props.modelId ?? workspaceStore.availableModels[0]?.id` to kick in and reset the dropdown.

The correct query pattern already exists in `handlers/tasks.ts` as `fetchTaskWithDetail()` and in `stream-processor.ts`'s `finally` block, but those helpers are not accessible to the orchestrator or executor classes.

## Goals / Non-Goals

**Goals:**
- Create a single shared module with two canonical DB helpers: `fetchTaskWithModel` and `fetchChatSessionWithModel`, each including the `LEFT JOIN conversations` required for the `conversation_model` column
- Replace all 9 bare-query sites that feed into WebSocket push paths with calls to these helpers
- Fix `task-repository.ts:findById` (latent same-type bug)
- Migrate `handlers/tasks.ts:fetchTaskWithDetail` to use the shared helper
- Remove the fragile `isUserChangingModel` / `setTimeout` workaround from `SessionChatView.vue`

**Non-Goals:**
- Changes to the WebSocket event shape or RPC contract
- Any changes to how the model is stored or resolved during execution
- Frontend defensive null-preservation (backend fix is sufficient)
- Performance optimization of the queries

## Decisions

### Decision: Extract to `src/bun/db/task-queries.ts`

**Choice**: New dedicated module rather than inline at each site or adding to `task-repository.ts`.

**Rationale**: The affected sites span `engine/orchestrator.ts`, three executor classes, and `handlers/chat-sessions.ts` — none of which currently share a common import ancestor short of the full `Database`. Adding to `task-repository.ts` would put handler-level logic inside a repository, violating separation of concerns. A small query-helper module is the lightest abstraction that achieves DRY without adding a god class.

**Alternatives considered**:
- *Inline at each site*: leaves the query string duplicated across 5+ files; next author can copy the wrong version
- *Extend task-repository*: mixes repository-pattern (entity CRUD) with mapper-level concerns (`mapTask`)

### Decision: `fetchTaskWithModel` returns `Task | null`, not `TaskRow`

**Choice**: Return the already-mapped `Task` domain object.

**Rationale**: All call sites need the mapped `Task` to pass to `onTaskUpdated()`. Returning a raw row would require every caller to call `mapTask()` themselves, defeating the purpose of the helper. The helper encapsulates the query + mapping as a single atomic operation.

### Decision: Keep the `chatSessions.setModel` WebSocket push, fix the JOIN

**Choice**: Fix the query rather than removing the push.

**Rationale**: The push is useful for multi-tab scenarios. `tasks.setModel` omits the push by design (task model changes are lower frequency and the caller updates its store from the HTTP response). Session model changes follow the same pattern as other session mutations — a push is consistent with rename/archive. After the JOIN fix, the push carries correct data.

### Decision: Remove `isUserChangingModel` guard in `SessionChatView`

**Choice**: Delete the guard entirely, not simplify it.

**Rationale**: The guard was added as a bandaid for exactly this bug. Once the backend sends correct data, the guard has no job. It introduces a 100ms race condition and hidden state that confuses future readers. `TaskChatView` has never needed such a guard — session chat should be equally clean.

## Risks / Trade-offs

- **[Risk] Other callers of `fetchTaskWithDetail` outside the scanned files** → Mitigation: grep confirms `fetchTaskWithDetail` is only defined and used in `handlers/tasks.ts`; it is not exported
- **[Risk] `task-repository.ts:findById` starts being used in a push path before this fix** → Mitigation: fix is included in this change; risk window is closed
- **[Risk] New bare queries introduced in the future** → Mitigation: the shared module makes the correct query the path of least resistance; a code-review note in design.md is sufficient

## Migration Plan

Pure in-process change — no DB schema changes, no migration needed. Deploy is a straightforward server restart.
