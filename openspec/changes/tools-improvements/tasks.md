## 1. Frontend: DecisionRequest toggle + multiselect bug fix

- [ ] 1.1 Add `recordAsDecisions` ref (default `true`) to `DecisionRequest.vue`
- [ ] 1.2 Add "Record as decisions" checkbox UI near the Submit button in `DecisionRequest.vue`
- [ ] 1.3 Include `recordAsDecisions` in the submit emit payload of `DecisionRequest.vue`
- [ ] 1.4 Fix multiselect "Other" textarea visibility: change desc-area condition from `focusedOption[qi] === '__other__'` to `isSelected(qi, q, '__other__')` in `DecisionRequest.vue`
- [ ] 1.5 Update desc-area class binding to use `isSelected(qi, q, '__other__')` instead of `focusedOption[qi] === '__other__'` in `DecisionRequest.vue`
- [ ] 1.6 Verify notes textarea logic still works correctly with the new conditional in `DecisionRequest.vue`

## 2. Extract DecisionRequest logic to testable utilities

- [ ] 2.1 Create `src/mainview/utils/decisionRequest.ts` with pure functions extracted from `DecisionRequest.vue`:
  - `canSubmitDecisionRequest(questions, state)` — per-question validation (freetext, exclusive+Other, non_exclusive+Other)
  - `buildDecisionAnswerParts(questions, state)` — formatted Q/A text array (used for `text` payload)
  - `buildDecisionAnswers(questions, state)` — structured `DecisionAnswer[]` array (used for `decisions` payload)
  - `isOptionSelected(question, title, state)` — selection check for exclusive/non_exclusive
  - `buildSubmissionText(questions, state, generalNotes)` — composes final text with general notes suffix
- [ ] 2.2 Import the extracted utilities in `DecisionRequest.vue`'s `canSubmit` computed, `submit()`, and `isSelected()` — replacing inline logic
- [ ] 2.3 Add `src/mainview/utils/decisionRequest.test.ts` with unit tests (see section 6)

## 3. Frontend: Thread recordAsDecisions through stores and RPC

- [ ] 3.1 Update `onInterviewSubmit` in `MessageBubble.vue` to destructure and pass `recordAsDecisions` to both task and chat store `submitDecisions` methods
- [ ] 3.2 Add `recordAsDecisions?: boolean = true` parameter to `submitDecisions` in `src/mainview/stores/task.ts` and pass it to the RPC call
- [ ] 3.3 Add `recordAsDecisions?: boolean = true` parameter to `submitDecisions` in `src/mainview/stores/chat.ts` and pass it to the RPC call
- [ ] 3.4 Add `recordAsDecisions?: boolean` to both `tasks.submitDecisions` and `chatSessions.submitDecisions` params in `src/shared/rpc-types.ts`

## 4. Backend: Conditional decision submission

- [ ] 4.1 Extend `buildDecisionSubmission` signature to `(answers, generalNotes?, recordAsDecisions = true)` in `src/bun/conversation/decision-submission.ts`
- [ ] 4.2 Add `NO_RECORD_INSTRUCTION` constant ("These are questions, not decisions. Do NOT call record_decision or update_decision for any of them.")
- [ ] 4.3 Make `engineContent = userContent + (recordAsDecisions ? HIDDEN_INSTRUCTION : NO_RECORD_INSTRUCTION)` — `userContent` unchanged in both cases
- [ ] 4.4 Update `tasks.submitDecisions` handler in `src/bun/handlers/tasks.ts` to read `recordAsDecisions` from params (default `true`) and pass to `buildDecisionSubmission`
- [ ] 4.5 Update `chatSessions.submitDecisions` handler in `src/bun/handlers/chat-sessions.ts` to read `recordAsDecisions` from params (default `true`) and pass to `buildDecisionSubmission`

## 5. Tool description updates

- [ ] 5.1 Remove the "call record_decision... for EVERY question" line from `DECISION_REQUEST_TOOL_DEFINITION` in `src/bun/engine/decision-request-tool-definition.ts` (keeps weight/model_lean/answers_affect_followup fields)
- [ ] 5.2 Soften `record_decision` description in `src/bun/engine/common-tools.ts` — remove "ALWAYS call this tool after every decision_request response to record each answered question — never skip or defer." and replace with toggle-aware wording
- [ ] 5.3 Verify `record_decision` description in `src/bun/workflow/tools/registry.ts` is consistent (currently does NOT have the always-record mandate — confirm no change needed, or align if the toggle-driven behavior should be reflected)
- [ ] 5.4 Add "⚠️ NOTE TOOL — use ONLY when the user EXPLICITLY asks to create a note." prefix to `create_note` description in `src/bun/engine/common-tools.ts`
- [ ] 5.5 Add "⚠️ NOTE TOOL — use ONLY when the user EXPLICITLY asks to edit or update a note." prefix to `update_note` description in `src/bun/engine/common-tools.ts`

## 6. Remove ask_me from registry

- [ ] 6.1 Remove the `ask_me` tool definition from `TOOL_DEFINITIONS` in `src/bun/workflow/tools/registry.ts`
- [ ] 6.2 Update `TOOL_GROUPS["interactions"]` from `["ask_me", "decision_request"]` to `["decision_request"]` in `src/bun/workflow/tools/registry.ts`
- [ ] 6.3 Remove the `ask_me` entry from `TOOL_DESCRIPTIONS` in `src/bun/workflow/tools/registry.ts`
- [ ] 6.4 Update `src/bun/test/tools.test.ts` — change the test that uses `["cards_read", "ask_me"]` to reference `decision_request` or remove the `ask_me` assertion

## 7. Unit tests: buildDecisionSubmission (src/bun/test/decision-submission.test.ts)

- [ ] 7.1 DS-13: `recordAsDecisions: false` → engineContent contains NO_RECORD_INSTRUCTION ("Do NOT call record_decision")
- [ ] 7.2 DS-14: `recordAsDecisions: false` → engineContent does NOT contain "list_decisions()"
- [ ] 7.3 DS-15: `recordAsDecisions: false` → engineContent does NOT contain "update_decision"
- [ ] 7.4 DS-16: `recordAsDecisions: false` → userContent is identical to `recordAsDecisions: true` (Q/A formatting unchanged)
- [ ] 7.5 DS-17: `recordAsDecisions: false` → NO_RECORD_INSTRUCTION is NOT present in userContent (hidden only)
- [ ] 7.6 DS-18: `recordAsDecisions: false` with generalNotes → NO_RECORD_INSTRUCTION still appended after general notes
- [ ] 7.7 DS-19: Verify existing DS-1..DS-12 still pass with the new default `recordAsDecisions = true` (no assertion changes)

## 8. Unit tests: DecisionRequest logic utilities (src/mainview/utils/decisionRequest.test.ts — NEW)

- [ ] 8.1 DRU-1: `canSubmitDecisionRequest` — exclusive question requires single selection; returns false when no selection, true when selected
- [ ] 8.2 DRU-2: `canSubmitDecisionRequest` — exclusive question with "__other__" selected requires other text filled
- [ ] 8.3 DRU-3: `canSubmitDecisionRequest` — non_exclusive requires at least one selection; empty selection returns false
- [ ] 8.4 DRU-4: `canSubmitDecisionRequest` — non_exclusive with "__other__" selected requires other text filled
- [ ] 8.5 DRU-5: `canSubmitDecisionRequest` — freetext requires non-empty trimmed text
- [ ] 8.6 DRU-6: `canSubmitDecisionRequest` — multi-question batch requires ALL questions answered
- [ ] 8.7 DRU-7: `buildDecisionAnswerParts` — formats exclusive answer as `Q:` / `A:` text
- [ ] 8.8 DRU-8: `buildDecisionAnswerParts` — formats non_exclusive multi-select as comma-joined answer; "__other__" replaced with other text value
- [ ] 8.9 DRU-9: `buildDecisionAnswerParts` — formats freetext answer
- [ ] 8.10 DRU-10: `buildDecisionAnswers` — returns `DecisionAnswer[]` with question, answer, weight, notes for each question
- [ ] 8.11 DRU-11: `buildDecisionAnswers` — notes omitted from `DecisionAnswer` when empty
- [ ] 8.12 DRU-12: `buildSubmissionText` — joins parts with double newline and appends general notes with `---` separator
- [ ] 8.13 DRU-13: `isOptionSelected` — returns true for selected exclusive option, false for unselected; true for selected non_exclusive option

## 9. Unit tests: Backend handlers (src/bun/test/decision-handlers.test.ts)

- [ ] 9.1 DH-5: `tasks.submitDecisions({ taskId, answers, recordAsDecisions: false })` → engineContent contains NO_RECORD_INSTRUCTION and does NOT contain "list_decisions()" or "record_decision"
- [ ] 9.2 DH-6: `tasks.submitDecisions({ taskId, answers, recordAsDecisions: false })` → userContent unchanged (no hidden instruction in user-visible text)
- [ ] 9.3 DH-7: `chatSessions.submitDecisions({ sessionId, answers, recordAsDecisions: false })` → engineContent contains NO_RECORD_INSTRUCTION
- [ ] 9.4 DH-8: `tasks.submitDecisions({ taskId, answers })` without flag → defaults to recording (existing DH-2 covers, regression guard)
- [ ] 9.5 DH-9: `chatSessions.submitDecisions({ sessionId, answers })` without flag → defaults to recording (existing DH-4 covers, regression guard)
- [ ] 9.6 DH-10: `tasks.submitDecisions({ taskId, answers, recordAsDecisions: false })` → userContent still contains formatted `Q [WEIGHT]:` / `A:` pairs

## 10. Unit tests: Store threading (src/mainview/stores/task.test.ts, chat.test.ts)

- [ ] 10.1 T-SC-5: `taskStore.submitDecisions(1, [], undefined, false)` → apiMock called with `tasks.submitDecisions` and `recordAsDecisions: false`
- [ ] 10.2 T-SC-6: `taskStore.submitDecisions(1, [])` → apiMock called with `tasks.submitDecisions` and `recordAsDecisions: true` (default)
- [ ] 10.3 C-14: `chatStore.submitDecisions(1, [], undefined, false)` → apiMock called with `chatSessions.submitDecisions` and `recordAsDecisions: false`
- [ ] 10.4 C-15: `chatStore.submitDecisions(1, [])` → apiMock called with `chatSessions.submitDecisions` and `recordAsDecisions: true` (default)

## 11. Unit tests: Tool description content (src/bun/test/common-tools-registration.test.ts, tools.test.ts)

- [ ] 11.1 CTR-D-4: `decision_request` tool definition description does NOT contain "call record_decision" or "never skip this step"
- [ ] 11.2 CTR-D-5: `decision_request` tool definition still mentions `weight`, `model_lean`, `answers_affect_followup`
- [ ] 11.3 CTR-D-6: `record_decision` description no longer contains "ALWAYS call this tool after every decision_request response"; still contains ALWAYS/NEVER (from list_decisions line) so CTR-D-1 passes
- [ ] 11.4 CTR-D-7: `create_note` description contains "EXPLICITLY asks"
- [ ] 11.5 CTR-D-8: `update_note` description contains "EXPLICITLY asks"
- [ ] 11.6 CTR-D-9: `create_note` description still explains note scope, content, visibility
- [ ] 11.7 Update `src/bun/test/tools.test.ts` to assert `ask_me` is NOT in resolved tools when `resolveToolsForColumn(["interactions"])` is called; `decision_request` IS present

## 12. E2E Playwright tests (e2e/ui/interview-me.spec.ts)

- [ ] 12.1 T-P1: "Record as decisions" checkbox is visible and checked by default in a decision request form
- [ ] 12.2 T-P2: Unchecking "Record as decisions" and submitting sends `recordAsDecisions: false` in the `tasks.submitDecisions` body
- [ ] 12.3 T-P3: Leaving "Record as decisions" checked and submitting sends `recordAsDecisions: true` in the `tasks.submitDecisions` body
- [ ] 12.4 T-Q1: For non_exclusive question, clicking the "Other" checkbox directly (not the row) shows the Other textarea and enabling submit when text is filled (multiselect validation bug regression test)
- [ ] 12.5 T-Q2: For non_exclusive question with "Other" checkbox checked but text empty, submit stays disabled
- [ ] 12.6 T-Q3: For exclusive question, "Record as decisions" toggle is visible regardless of question type
