## Why

The `interview_me` tool captures high-stakes architectural decisions during task execution, but those decisions are lost after context compaction — forcing the AI to re-ask or silently forget them. Renaming the tool to `decision_request` better reflects its purpose, and pairing it with a persistent decision record system ensures decisions survive compaction and remain injected into every execution's system instructions.

## What Changes

- **Rename** `interview_me` tool → `decision_request` across all engine adapters, stream processor, RPC types, and frontend components
- **New DB schema**: `decision_batches`, `decision_records`, `decision_revisions` tables scoped per conversation
- **Decision injection**: `ExecutionParamsBuilder` queries and appends a `## Decision Records` block to `systemInstructions` on every execution (tasks + chat sessions), surviving compaction
- **New AI toolset**: `record_decision` (silent create), `list_decisions`, `get_decision`, `update_decision` (requires reason, appends revision), `delete_decision` (soft-delete)
- **Extend `tasks.sendMessage` + `chatSessions.sendMessage`**: accept optional `decisionBatch` payload, persisted atomically before execution starts
- **`CommonToolContext` refactor**: restructure into scoped sub-objects (`task`, `repos`, `workflow`, `runtime`); add `decisionRepo: DecisionRepository`; `task` sub-object carries both `taskId: number | null` AND `conversationId: number` (chat sessions have `taskId = null` but always have `conversationId`)
- **New read-only Decisions tab**: added to both `TaskChatView` and `SessionChatView` (which gains a tab system); shows decisions grouped by batch vs. AI-recorded, with revision history
- **Width fix**: `DecisionRequest.vue` (renamed from `InterviewMe.vue`) uses `width: 100%` instead of hardcoded `max-width: 660px` to fill the resizable drawer

## Capabilities

### New Capabilities

- `decision-record`: Persistent decision records linked to conversations — schema (3 tables), `DecisionRepository`, system instructions injection, and the new AI management toolset (`record_decision`, `list_decisions`, `get_decision`, `update_decision`, `delete_decision`)
- `decision-request-ui`: Read-only Decisions tab in `TaskChatView` and `SessionChatView`; `DecisionRequest.vue` (renamed component) with dynamic width; `DecisionsPanel.vue` grouped display

### Modified Capabilities

- `engine-interview-common-tool`: Renamed to `engine-decision-common-tool`; tool name changes from `interview_me` to `decision_request`; tool description updated; `CommonToolContext` gains `decisionRepo` and `conversationId`
- `engine-common-tools`: Five new decision management tools added to the common tool registry; tool map updated; `interactions` group updated
- `engine-execution-params`: `ExecutionParamsBuilder` gains `DecisionRepository` constructor injection; both `build()` and `buildForChat()` append the decision block to `systemInstructions`
- `conversation-panel`: `MessageBubble.vue` references renamed from `interview_prompt` to `decision_request_prompt`; `InterviewMe.vue` → `DecisionRequest.vue`
- `task-detail`: `TaskChatView` adds a third tab (`Decisions`); `SessionChatView` gains the tab system (currently tab-less) with `Chat` + `Decisions` tabs

## Impact

- **DB**: New migration `040_decision_records.ts` — 3 new tables; no changes to existing tables
- **RPC**: `tasks.sendMessage` and `chatSessions.sendMessage` gain optional `decisionBatch?` param (**non-breaking** — optional field); new `decisions.list` and `decisions.getRevisions` read RPCs
- **`src/shared/rpc-types.ts`**: `MessageType` adds `decision_request_prompt`; removes `interview_prompt`; new `DecisionRecord`, `DecisionBatch`, `DecisionRevision` interfaces
- **Engine types**: `EngineEvent` union renamed member; `CommonToolContext` restructured
- **11 source files** contain `interview_me` references that are renamed
- **No test changes** in this change — test coverage is a separate follow-up
