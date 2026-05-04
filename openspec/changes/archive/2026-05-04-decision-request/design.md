## Context

The codebase has a working `interview_me` common tool that suspends engine execution to gather structured user input for high-stakes decisions. It stores the result as a `ConversationMessage` of type `interview_prompt`, but this is only text — the structured Q&A data is lost after the message is saved. When context compaction occurs, the AI has no memory of what was decided.

The existing architecture is well-structured for this extension: `ExecutionParamsBuilder` assembles `systemInstructions`, `CommonToolContext` is already injected into all engine common-tool handlers, `TodoRepository` establishes the DB repository pattern, and `tasks.sendMessage` / `chatSessions.sendMessage` already handle the execution handoff.

## Goals / Non-Goals

**Goals:**
- Rename `interview_me` → `decision_request` across all active source files (11 files)
- Persist structured decision records in SQLite, scoped to `conversation_id`
- Inject all non-deleted decisions into `systemInstructions` on every execution, surviving compaction
- Provide AI toolset: `record_decision`, `list_decisions`, `get_decision`, `update_decision` (with mandatory reason + revision log), `delete_decision` (soft-delete)
- Add read-only Decisions tab to `TaskChatView`; add full tab system (Chat + Decisions) to `SessionChatView`
- Fix `DecisionRequest.vue` (renamed) to use `width: 100%` instead of hardcoded `max-width: 660px`
- Refactor `CommonToolContext` into scoped sub-objects while touching that interface

**Non-Goals:**
- Test coverage for new decision tools (separate follow-up)
- Human edit/delete of decision records via UI (AI owns CRUD via tools)
- Renaming archived OpenSpec change documents
- Decision portability across tasks (decisions are conversation-scoped)

## Decisions

### 1. DB scoping: `conversation_id`, not `task_id`

Decision records are keyed to `conversation_id` (the universal routing key already used by `EngineEvent`, `StreamProcessor`, and `ExecutionParams`). This means both task-backed conversations and standalone chat sessions work uniformly without special-casing.

**Alternative considered**: `task_id` FK. Rejected because chat sessions have no `task_id`, creating an inconsistent two-code-path model.

### 2. Three-table schema: batches + records + revisions

```
decision_batches  (id, conversation_id, context, created_at)
decision_records  (id, conversation_id, batch_id?, question, answer, weight, notes,
                  revision_count, is_source_ai, is_deleted, created_at, updated_at)
decision_revisions (id, decision_id, previous_answer, previous_notes, reason, revised_at)
```

`decision_batches` groups records from a single `decision_request` interview session (for UI display grouping). `batch_id` is NULL for AI-recorded decisions (`record_decision` tool). `revision_count` in the record enables the AI to detect oscillation — a decision revised 3+ times should trigger a new `decision_request` to the user.

`is_source_ai` distinguishes user-confirmed decisions from AI self-recorded ones — shown in the UI as `[AI-recorded]` vs. implicit user confirmation.

**Alternative considered**: Single table with JSON blob for revision history. Rejected because it makes `UPDATE decision_records` non-atomic with history and makes querying revisions for `get_decision` awkward.

### 3. Injection via `DecisionRepository` injected into `ExecutionParamsBuilder`

`DecisionRepository` is injected into `ExecutionParamsBuilder`'s constructor (Option A DI). Both `build()` and `buildForChat()` call `decisionRepo.buildSystemBlock(conversationId)` and append the result to `systemInstructions` if non-empty.

This means all three executor paths (`TransitionExecutor`, `HumanTurnExecutor`, `ChatExecutor`) get decision injection without any of them knowing about decisions directly — they already delegate to `ExecutionParamsBuilder`.

**Injection format** (appended to end of systemInstructions):
```
## Decision Records
These decisions were made for this task. Honor them unless explicitly asked to reconsider.
Use list_decisions() to review all details. Use update_decision(id, answer, reason) to revise.

[CRITICAL] <question>
→ <answer>
  Notes: <notes if any>
  (revised 2x · last reason: "<reason>")

[MEDIUM] <question>  [AI-recorded]
→ <answer>
```

Ordered: critical → medium → easy (all non-deleted).

**Alternative considered**: Inject as a synthetic system conversation message. Rejected because it could be compacted away and requires engine-specific message format handling.

### 4. Decisions persisted atomically in `sendMessage` handlers

Both `tasks.sendMessage` and `chatSessions.sendMessage` accept an optional `decisionBatch?: { context?: string; decisions: DecisionInput[] }` param. When present, `DecisionRepository.persistBatch()` is called inside the same SQLite transaction as the message insert, before the execution is kicked off.

This guarantees decisions are available to `ExecutionParamsBuilder` on the first post-submit execution.

**Alternative considered**: Separate `decisions.record` RPC called by frontend before `sendMessage`. Rejected because it creates a race: the execution could start before the RPC completes.

### 5. `update_decision` requires `reason`, appends to `decision_revisions`

The `reason` field is required on `update_decision` — the AI must explain why it's revising. This prevents AI slop/loops by making oscillation visible: `revision_count` increments in `decision_records`, the full history lives in `decision_revisions`, and the injected system block shows revision count and last reason.

Tool description instructs: "If you have revised this decision more than twice, use `decision_request` instead to get explicit user input."

### 6. `CommonToolContext` refactored into scoped sub-objects

Since we're already touching every caller of `CommonToolContext`, we restructure it:

```typescript
interface CommonToolContext {
  task: {
    id: number | null;        // null for chat sessions
    boardId: number | null;   // null for chat sessions
    conversationId: number;   // ALWAYS set — universal routing key for both task and chat contexts
  };
  repos: { todos: TodoRepository; decisions: DecisionRepository };
  workflow: {
    onTransition: (taskId: number, toState: string) => void;
    onHumanTurn: (taskId: number, message: string) => void;
    onCancel: (executionId: number) => void;
    onTaskUpdated: (task: Task) => void;
  };
  runtime: { lspManager?: LSPServerManager; worktreePath?: string };
}
```

All existing tool handlers in `common-tools.ts` are updated to use the new paths (e.g. `ctx.todoRepo` → `ctx.repos.todos`, `ctx.taskId` → `ctx.task.id`). Decision tools use `ctx.task.conversationId`. Todo and board tools use `ctx.task.id` (guarded: `if (!ctx.task.id) return "Error: only available within a task execution"`). Both engines have `params.conversationId` in scope at context construction time and thread it in at zero cost.

### 7. `SessionChatView` gains a tab system

`SessionChatView` currently has no tabs. We add `[Chat] [Decisions]` tabs following the same pattern as `TaskChatView`. A reusable `TabSwitcher.vue` component is extracted to avoid duplicating CSS between the two views.

## Risks / Trade-offs

- **Token cost**: Injecting all decisions on every execution adds tokens linearly with decision count. For tasks with many decisions (10+), this is measurable. Mitigation: easy decisions could be skipped in a future optimization — the design supports this via the `weight` column filter.

- **`is_deleted` soft-delete**: Deleted decisions stay in DB. `buildSystemBlock` filters them (`WHERE is_deleted = 0`). The AI can still call `list_decisions` and see counts but not content. This is intentional — the revision table references them.

- **`CommonToolContext` refactor scope**: This touches `claude/adapter.ts`, `copilot/engine.ts`, and all common tool handler call sites. The refactor is mechanical (field path renaming) but must be done completely to avoid type errors.

- **`chatSessions.sendMessage` doesn't go through `HumanTurnExecutor`**: It calls `orchestrator.executeChatTurn()` directly. `ExecutionParamsBuilder.buildForChat()` is used there, which now accepts `DecisionRepository` — the injection path is the same, but the handler must also persist the batch before calling `executeChatTurn`.

## Migration Plan

1. Add migration `040_decision_records.ts` — creates 3 new tables, no existing table changes. Safe rollout.
2. Deploy backend with new tables, new `DecisionRepository`, updated handlers.
3. Frontend change is additive (new tab, renamed component, CSS fix) — backwards compatible.
4. No data migration needed — existing conversations have no decision records (empty block is omitted from systemInstructions).

## Open Questions

- None — all design decisions locked during exploration session.
