## Why

The `decision_request` tool is constantly erroring with `Error: field 'type' is required` (repeated per malformed question) and, when a malformed payload slips through, the interview silently suspends with `Interview suspended - awaiting user response.` carrying no usable questions. The root cause is the **one-shot batch schema**: `decision_request({ questions: [...] })` asks the model to produce a deeply nested array of complex question objects in a single call. Models — Sonnet 5 via the Cursor SDK in particular — fail to produce the nested `required`/`enum` fields (`type`) reliably, and the schema-dialect conversion inside Cursor's backend commonly drops nested constraints inside array items. The AJV gate then rejects the whole batch, the error gives no recovery hint, and the model retries the same broken batch — a loop.

The fix is to stop fighting the model's weakness: change the tool to accept **one question per call**, let the model call it repeatedly to build an interview incrementally, stream each question page to the UI live, and present the interview in a **fixed panel above the prompt input** (outside the chat stream) with paginated Back / Next / Submit navigation.

## What Changes

- **CHANGE**: `DECISION_REQUEST_TOOL_DEFINITION` schema — from `{ context?, questions: [...] }` (array) to `{ context?, question: {...} }` (single question per call). Strictly single-question; no legacy array form.
- **FIX**: `executeCommonTool` now calls `normalizeToolArguments` at the top (single choke-point) so string-encoded array/object args are reconciled identically across ALL engines before AJV validation.
- **FIX**: `validateToolArgs` required-field errors are now schema-aware — when a missing required field declares an `enum`, the error lists the valid values (e.g. `Error: field 'question.type' is required (valid values: "exclusive", "non_exclusive", "freetext")`), giving the model a recovery hint.
- **NEW**: `DecisionQuestionBuffer` — a per-execution in-memory buffer on `CommonToolContext.runtime` that accumulates questions across `decision_request` calls within one execution.
- **NEW**: `ToolExecutionResult` gains a `{ type: "page"; text; payload }` variant. A valid `decision_request` call appends to the buffer and returns `page` (loop continues) instead of `suspend` (loop aborts). Invalid single questions return an instructive error result and the buffer is preserved (only the bad call is rejected).
- **NEW**: engine wrappers (Pi, Cursor, Claude, Copilot, OpenCode) emit an ephemeral `decision_request_page` engine event per appended question so the UI streams pages live while the model is still working.
- **NEW**: turn-end flush — when an engine would emit `done` but the buffer is non-empty, it emits the terminal `decision_request` event with the full accumulated payload instead, persisting `decision_request_prompt` and transitioning to `waiting_user`. Empty buffer → normal `done`. Questions are never silently lost.
- **NEW**: `StreamEventType` gains `decision_request_page` (ephemeral, not persisted) alongside the existing `decision_request_prompt` (persisted terminal).
- **NEW**: `DecisionInterviewPanel.vue` — a fixed interview panel positioned above the todo list / changed-files list and above the prompt input (outside the chat stream). Paginated one-question-per-page with footer Back / Next / Submit. Submit active only at `waiting_user`; answers can be filled live while pages stream in.
- **CHANGE**: `DecisionRequest.vue` — pagination support (page index, Back/Next/Submit footer, per-page context rendering), replacing the stacked single-view layout.

## Capabilities

### New Capabilities
- `decision-interview-streaming`: streaming single-question `decision_request` accumulation — per-execution buffer, `page` tool result, ephemeral `decision_request_page` engine/stream events, turn-end flush to terminal `decision_request`, and the fixed `DecisionInterviewPanel` UI above the prompt input with Back / Next / Submit pagination.

### Modified Capabilities
- `engine-decision-common-tool`: `decision_request` becomes single-question-per-call with per-question context; no longer suspends per call; buffer keep-on-error semantics.
- `engine-common-tools`: `executeCommonTool` normalizes at the choke-point; `ToolExecutionResult` gains the `page` variant; `CommonToolContext.runtime` gains `decisionBuffer`.
- `engine-tool-input-validation`: `validateToolArgs` emits schema-aware enum hints for missing required fields.
- `decision-request-ui`: `DecisionRequest.vue` pagination + per-question context; new `DecisionInterviewPanel.vue` placement; `MessageBubble.vue` retires in-chat rendering for new interviews.

## Impact

- **Files changed**: `src/bun/engine/decision-request-tool-definition.ts`, `src/bun/engine/common-tools.ts`, `src/bun/engine/validate-tool-args.ts`, `src/bun/engine/types.ts`, `src/bun/engine/decision-buffer.ts` (new), engine wrappers/turn-end in `pi/` `cursor/` `claude/` `copilot/` `opencode/`, `src/shared/rpc-types.ts`, `src/mainview/stores/conversation.ts`, `src/mainview/components/DecisionInterviewPanel.vue` (new), `src/mainview/components/DecisionRequest.vue`, `src/mainview/components/TaskChatView.vue`, `src/mainview/components/SessionChatView.vue`, `src/mainview/components/MessageBubble.vue`.
- **API/schema change**: `decision_request` tool input schema changes from array to single question — all array-form callers/tests must migrate to per-question calls. `DecisionRequestPayload` (UI-facing) shape is preserved for compatibility.
- **Behavior change**: `decision_request` no longer suspends immediately on call; the interview is presented at turn end via turn-end flush. User answers can be filled while the model is still working; Submit activates at `waiting_user`.
- **No DB migration** — `conversation_messages` and `decision_records` shapes are unchanged.
- **Dependencies**: none new (existing `ajv`, `@cursor/sdk`, etc.).
- **Testing**: full test plan across all four layers (L1 unit, L2 component-DI, L3 in-memory-DB integration, L4 Playwright) is included in this change — see `design.md` Testing Strategy (D10–D13) and `tasks.md` sections 10–14. All existing array-form test callers migrate to single-question calls.
