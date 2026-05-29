## Why

The model `<Select>` dropdown in both task chat and session chat resets to the first available model whenever any chat interaction occurs (cancel, code review, shell approval, model change). This happens because several backend code paths broadcast `task.updated` or `chatSession.updated` WebSocket events using bare `SELECT * FROM tasks/chat_sessions` queries that lack the `LEFT JOIN conversations` join — causing `model: null` to reach the frontend, which then falls back to the first available model.

## What Changes

- **New shared module** `src/bun/db/task-queries.ts` with two exported helpers:
  - `fetchTaskWithModel(db, taskId)` — canonical task query with `conversations` JOIN
  - `fetchChatSessionWithModel(db, sessionId)` — canonical session query with `conversations` JOIN
- **Fix `orchestrator.ts`**: Replace 2 bare task queries (cancel, shell approval) with `fetchTaskWithModel`
- **Fix `code-review-executor.ts`**: Replace 1 bare task query with `fetchTaskWithModel`
- **Fix `transition-executor.ts`**: Replace 2 bare task queries with `fetchTaskWithModel`
- **Fix `chat-sessions.ts`**: Replace 5 bare session queries (setModel, create, rename, archive, cancel) with `fetchChatSessionWithModel`
- **Fix `task-repository.ts`**: Add `LEFT JOIN conversations` to `findById` (latent bug)
- **Fix `handlers/tasks.ts`**: Replace `fetchTaskWithDetail` inline body with delegation to `fetchTaskWithModel`
- **Cleanup `SessionChatView.vue`**: Remove `isUserChangingModel` ref, `previousModelId` ref, and `setTimeout` workaround — simplify the model-change watcher

## Capabilities

### New Capabilities
- `task-query-helpers`: Shared DB query helpers for fetching task and chat-session with conversation model JOIN — single source of truth used across handlers, orchestrators, and executors

### Modified Capabilities
- `model-selection`: Requirement: model selection is preserved across all WebSocket push paths (cancel, shell approval, code review, session operations). The model stored in `conversations.model` must be correctly propagated in every event broadcast to connected clients.

## Impact

- **Backend files changed**: `orchestrator.ts`, `code-review-executor.ts`, `transition-executor.ts`, `chat-sessions.ts`, `task-repository.ts`, `handlers/tasks.ts`
- **New file**: `src/bun/db/task-queries.ts`
- **Frontend files changed**: `src/mainview/components/SessionChatView.vue`
- **No API contract changes** — `task.updated` and `chatSession.updated` WebSocket events keep their existing shape; they just carry correct `model` values
- **No migration needed** — data model is unchanged; this is a read-path fix only

## Related Change

Test coverage for this fix lives in a separate proposal: **`fix-model-select-reset-tests`**. That change covers 25 tests across 6 layers (unit, integration, frontend store, and Playwright E2E) and includes extraction of shared executor test stubs to `src/bun/test/executor-test-helpers.ts`. Apply this production change first — the tests depend on the fixes being in place.
