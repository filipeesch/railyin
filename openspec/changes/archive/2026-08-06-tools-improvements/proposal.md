## Why

The `decision_request` tool always records answers as decisions, but users sometimes want to ask clarifying questions without persisting them as formal decision records. Additionally, the `ask_me` tool is stale/unused and the note tools lack explicit-user-intent guards that board tools already have.

## What Changes

- **DecisionRequest UI toggle**: Add a **"Record as decisions"** checkbox near the Submit button (default: checked). When unchecked, answers are still collected and formatted as Q/A pairs, but the model receives an imperative instruction NOT to call `record_decision`/`update_decision` for those answers.
- **Conditional hidden instruction**: `buildDecisionSubmission` gains a `recordAsDecisions` parameter (default `true`). When `true`, the existing hidden `list_decisions`/`record_decision`/`update_decision` instruction is appended to `engineContent`. When `false`, a new `NO_RECORD_INSTRUCTION` ("These are questions, not decisions. Do NOT call record_decision or update_decision for any of them.") replaces it. `userContent` is identical in both cases.
- **decision_request tool description update**: Remove the blanket "After the user submits answers, call record_decision (or update_decision if a record already exists) for EVERY question — never skip this step." line from the tool definition, since the toggle now controls this. Keep all other fields (`weight`, `model_lean`, `answers_affect_followup`).
- **record_decision tool description update**: Soften the "ALWAYS call this tool after every decision_request response to record each answered question — never skip or defer." mandate in `common-tools.ts` to reflect toggle-driven behavior. Verify `registry.ts`'s `record_decision` description (which currently lacks the mandate) for consistency.
- **RPC & handler plumbing**: Add optional `recordAsDecisions?: boolean` to both `tasks.submitDecisions` and `chatSessions.submitDecisions` RPC params, threaded through stores, MessageBubble, and backend handlers.
- **ask_me removal** (**registry-level**): Remove `ask_me` from `TOOL_DEFINITIONS`, `TOOL_GROUPS["interactions"]`, and `TOOL_DESCRIPTIONS` in `registry.ts`. Update affected tests. `AskUserPrompt.vue`, types, and native engine ask paths remain for `shell_approval` compat.
- **Note tool guards**: Add "⚠️ NOTE TOOL — use ONLY when the user EXPLICITLY asks to create/update a note." to the `create_note` and `update_note` tool descriptions.
- **Multiselect validation fix**: In `DecisionRequest.vue`, always render the "Other" textarea when `__other__` is selected in the checkbox group — regardless of `focusedOption`. Currently clicking the "Other" checkbox via `@click.stop` leaves `focusedOption` unchanged, hiding the required textarea and deadlocking the submit button.
- **Extract DecisionRequest logic to testable utilities**: Extract `canSubmit` validation, answer formatting, and selection-state logic from `DecisionRequest.vue` into a plain `src/mainview/utils/decisionRequest.ts` module. Enable `bun test` unit coverage without Vue SFC compilation (no @vue/test-utils — component rendering/interaction covered by Playwright e2e).

## Capabilities

### New Capabilities
- `decision-request-record-toggle`: The decision request UI's toggle controlling whether user answers are persisted as decision records, and the conditional instruction plumbing.

### Modified Capabilities
- `decision-submission-rpc`: `tasks.submitDecisions` and `chatSessions.submitDecisions` now accept `recordAsDecisions`; `buildDecisionSubmission` produces different engine content based on it.
- `engine-decision-common-tool`: `decision_request` tool description no longer mandates calling `record_decision`; `record_decision` description reflects toggle-driven usage (in `common-tools.ts`; `registry.ts` verified consistent).
- `decision-request-ui`: `DecisionRequest.vue` gains the "Record as decisions" checkbox, fixes the multiselect "Other" textarea visibility bug, and delegates validation/formatting to extracted utility functions.
- `task-note-tools`: `create_note` and `update_note` descriptions now require explicit user intent.
- `ask-user-tool`: `ask_me` is removed from the tool registry (`TOOL_DEFINITIONS`, `TOOL_GROUPS`, `TOOL_DESCRIPTIONS`).

## Impact

- **Frontend**: `DecisionRequest.vue` (toggle + multiselect fix + delegate to utilities), `MessageBubble.vue` (thread flag), `stores/task.ts` & `stores/chat.ts` (pass flag), `shared/rpc-types.ts` (RPC param types), NEW `utils/decisionRequest.ts` + `utils/decisionRequest.test.ts`.
- **Backend**: `handlers/tasks.ts` & `handlers/chat-sessions.ts` (pass flag), `conversation/decision-submission.ts` (conditional instruction), `engine/decision-request-tool-definition.ts` (description), `engine/common-tools.ts` (record_decision desc + note tool descs), `workflow/tools/registry.ts` (remove ask_me, verify record_decision desc).
- **Tests**: `test/tools.test.ts` (remove ask_me assertions, add interactions group check), `test/decision-submission.test.ts` (new DS-13..DS-19 for recordAsDecisions), `test/decision-handlers.test.ts` (new DH-5..DH-10), `test/common-tools-registration.test.ts` (new CTR-D-4..CTR-D-9 for description content), `src/mainview/stores/task.test.ts` & `chat.test.ts` (store threading tests), NEW `utils/decisionRequest.test.ts` (DRU-1..DRU-13), e2e `e2e/ui/interview-me.spec.ts` (T-P1..T-P3 toggle, T-Q1..T-Q3 multiselect fix).
