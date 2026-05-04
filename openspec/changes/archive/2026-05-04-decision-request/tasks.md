## 1. Database & Repository

- [x] 1.1 Write migration `YYYYMMDDHHMMSS_decision_records.ts` creating `decision_batches`, `decision_records`, and `decision_revisions` tables with FK constraints and indexes on `(conversation_id, is_deleted)` and `(decision_id)`
- [x] 1.2 Create `src/bun/db/repositories/decision-repository.ts` with `DecisionRepository` class: `createBatch`, `createRecord`, `updateRecord`, `deleteRecord`, `listByConversation`, `getRevisions`, `buildSystemBlock` — constructor receives `Database`
- [x] 1.3 Register `DecisionRepository` in the DI wiring (wherever `TodoRepository` is instantiated and passed) so it is available app-wide

## 2. Rename interview_me → decision_request (tool layer)

- [x] 2.1 Rename `src/bun/engine/interview-tool-definition.ts` → `decision-request-tool-definition.ts`; rename export `INTERVIEW_ME_TOOL_DEFINITION` → `DECISION_REQUEST_TOOL_DEFINITION`; change tool `name` field from `"interview_me"` to `"decision_request"`
- [x] 2.2 Update `src/bun/engine/types.ts`: rename `EngineEvent` member `{ type: "interview_me" }` → `{ type: "decision_request" }`; restructure `CommonToolContext` into scoped sub-objects (`task`, `repos`, `workflow`, `runtime`)
- [x] 2.3 Update `src/bun/engine/stream/stream-processor.ts`: rename all `interview_me` case/event references to `decision_request`
- [x] 2.4 Update `src/bun/engine/common-tools.ts`: rename `interview_me` handler case → `decision_request`; update all imports; adapt to new `CommonToolContext` shape (`ctx.repos.decisions`, `ctx.runtime.interview`, `ctx.workflow.transition`)
- [x] 2.5 Update `src/bun/workflow/tools/registry.ts`: rename `interview_me` entries → `decision_request`; update import to `DECISION_REQUEST_TOOL_DEFINITION`
- [x] 2.6 Update `src/shared/rpc-types.ts`: rename `"interview_prompt"` → `"decision_request_prompt"` in `MessageType`; rename `InterviewPayload`/`InterviewQuestion`/`InterviewOption` → `DecisionRequestPayload`/`DecisionRequestQuestion`/`DecisionRequestOption`; add `DecisionRecord`, `DecisionBatch`, `DecisionRevision` interfaces; add `decisions.list` and `decisions.getRevisions` RPC method types

## 3. New Decision AI Tools

- [x] 3.1 Implement `record_decision` handler in `common-tools.ts`: accepts `question`, `answer`, optional `weight`; calls `ctx.repos.decisions.createRecord(..., isSourceAi: true)`; returns confirmation string; does NOT suspend
- [x] 3.2 Implement `list_decisions` handler: calls `ctx.repos.decisions.listByConversation(ctx.task.taskId or conversationId)`; returns JSON array
- [x] 3.3 Implement `update_decision` handler: validates `reason` is present (reject with error if missing); calls `ctx.repos.decisions.updateRecord(id, newAnswer, reason)`
- [x] 3.4 Implement `delete_decision` handler: calls `ctx.repos.decisions.deleteRecord(id)`; returns confirmation string
- [x] 3.5 Register all four new decision tools in `registry.ts` with tool definitions (schema: `id`, `question`, `answer`, `weight`, `reason` as applicable); add to the tool group that includes `create_todo` / `interview_me`

## 4. ExecutionParamsBuilder — DecisionRepository injection

- [x] 4.1 Add `DecisionRepository` constructor parameter to `ExecutionParamsBuilder`; update all call sites (Orchestrator, chat handler) to inject the instance
- [x] 4.2 In `build()` and `buildForChat()`: call `this.decisionRepo.buildSystemBlock(conversationId)` and append non-empty result to `systemInstructions` before returning `ExecutionParams`

## 5. sendMessage — Atomic Decision Persistence

- [x] 5.1 Extend `tasks.sendMessage` RPC handler to accept an optional `decisionBatch?: { label?: string; records: { question: string; answer: string; weight: string }[] }` parameter
- [x] 5.2 Wrap message insert + `decisionRepo.createBatch(...)` + `decisionRepo.createRecord(...)` calls in a single SQLite transaction inside the `tasks.sendMessage` handler
- [x] 5.3 Apply the same atomic extension to `chatSessions.sendMessage`

## 6. Frontend — Component Renames & Width Fix

- [x] 6.1 Rename `src/mainview/components/InterviewMe.vue` → `DecisionRequest.vue`; update the component's CSS: replace `max-width: 660px` with `width: 100%`; update all internal references from `interview_me`/`InterviewMe` to `decision_request`/`DecisionRequest`
- [x] 6.2 Update `src/mainview/components/MessageBubble.vue` (and any other rendering layer): replace `interview_me` / `interview_prompt` references with `decision_request` / `decision_request_prompt`; import `DecisionRequest.vue` instead of `InterviewMe.vue`
- [x] 6.3 Extract `src/mainview/components/TabSwitcher.vue` shared component with `tabs: { id, label }[]` prop, `modelValue` prop, and `update:modelValue` emit
- [x] 6.4 Create `src/mainview/components/DecisionsPanel.vue`: accepts `conversationId` prop; fetches via `decisions.list` RPC on mount; renders records grouped by weight with question, answer, weight badge, `[AI-recorded]` tag, revision count badge; shows empty-state message when no records; panel is read-only

## 7. Frontend — Tabs & RPC

- [x] 7.1 Update `src/mainview/components/TaskChatView.vue`: replace inline tab CSS with `TabSwitcher`; add `"decisions"` to `activeTab` type; add Decisions tab entry; render `DecisionsPanel` when `activeTab === "decisions"`
- [x] 7.2 Update `src/mainview/components/SessionChatView.vue`: add full tab system using `TabSwitcher` with `"chat"` and `"decisions"` tabs; render `DecisionsPanel` in decisions tab; default to `"chat"` tab
- [x] 7.3 Add `decisions.list` and `decisions.getRevisions` backend RPC handlers in `src/bun/handlers/`
- [x] 7.4 Add typed `decisions.list` and `decisions.getRevisions` wrappers to `src/mainview/rpc.ts`
- [x] 7.5 Update frontend `sendMessage` call sites to pass `decisionBatch` payload when resuming from a `decision_request` interactive block

## 8. Cleanup & Refactoring

- [x] 8.1 Remove the double comment on `src/bun/handlers/tasks.ts` lines 473–474
- [x] 8.2 Extract `_buildBase()` shared helper in `ExecutionParamsBuilder` to deduplicate common fields between `build()` and `buildForChat()`
- [x] 8.3 Verify no remaining references to `interview_me` exist in non-archived source files: `git grep -r "interview_me" src/ openspec/specs/ openspec/changes/decision-request/`
