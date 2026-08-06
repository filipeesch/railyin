## Context

The `decision_request` tool currently always records user answers as decision records. The backend `buildDecisionSubmission` appends a hidden instruction telling the model to call `list_decisions()` + `record_decision`/`update_decision` for every answer. The user wants the ability to ask questions WITHOUT that recording step — a simpler ask/response UX.

Additionally, `ask_me` is a stale tool definition in the registry that is not configured in any workflow and should be removed at the registry level. Note tool descriptions (`create_note`, `update_note`) lack the explicit-user-intent guard that board tools already have. There's also a known multiselect validation bug in `DecisionRequest.vue` where clicking the "Other" checkbox deadlocks submission.

## Goals / Non-Goals

**Goals:**
- Add a "Record as decisions" checkbox (default ON) to `DecisionRequest.vue` that controls whether answers are persisted as decision records.
- Make `buildDecisionSubmission` inject a different hidden instruction based on the `recordAsDecisions` flag.
- Remove the always-record mandate from `decision_request` and `record_decision` tool descriptions.
- Remove `ask_me` from the tool registry (definition, group, descriptions).
- Add "EXPLICITLY ask" guards to `create_note` and `update_note` descriptions.
- Fix the multiselect "Other" textarea visibility bug in `DecisionRequest.vue`.

**Non-Goals:**
- Do NOT remove `AskUserPrompt.vue`, `AskUserPromptContent` types, or native engine `ask_user` handling — they remain for `shell_approval` compat.
- Do NOT change the stored `DecisionAnswer` shape or add new fields.
- Do NOT add a new tool name — the toggle leverages the existing `decision_request` tool.
- No schema/data migrations.

## Decisions

### Decision 1: Toggle controls hidden instruction, not a separate tool/path

Instead of creating a separate "ask_question" tool, we reuse `decision_request` and add a UI toggle. The toggle only affects the **engine content** (what the model sees) — the user-facing Q/A text stays identical.

**Why:** Minimal surface change. No new tool, no new message type, no schema shift. The model already knows how to handle Q/A formatted answers; the toggle just tells it whether to persist them.

**Alternatives considered:**
- New "ask_question" tool → rejected: duplicate schema/plumbing for marginal value.
- Separate `ask_user_prompt` path → rejected: `ask_me` is being removed and `ask_user_prompt` is shell-approval-coupled.

### Decision 2: `recordAsDecisions` flows through RPC params as optional boolean (default true)

Both `tasks.submitDecisions` and `chatSessions.submitDecisions` gain `recordAsDecisions?: boolean` (default `true`). It flows: DecisionRequest.vue → MessageBubble → store → RPC → backend handler → `buildDecisionSubmission`.

**Why:** Backward compatible — existing callers (and tests) without the flag behave identically. The default `true` means no behavior change for clients that don't pass it.

### Decision 3: Hidden instruction is conditional in `buildDecisionSubmission`

Signature changes to `buildDecisionSubmission(answers, generalNotes?, recordAsDecisions = true)`. Two instruction constants:
- `HIDDEN_INSTRUCTION` (existing): tells model to `list_decisions()` first, update or record.
- `NO_RECORD_INSTRUCTION` (new): `"IMPORTANT: These are questions, not decisions. Do NOT call record_decision or update_decision for any of them."`

`engineContent = userContent + (recordAsDecisions ? HIDDEN_INSTRUCTION : NO_RECORD_INSTRUCTION)`. `userContent` is unchanged in both cases.

### Decision 4: Tool descriptions lose the always-record mandate

- `decision-request-tool-definition.ts`: remove the `"- After the user submits answers, call record_decision (or update_decision if a record already exists) for EVERY question — never skip this step."` line. Keep all other fields (`weight`, `model_lean`, `answers_affect_followup`, etc.).
- `common-tools.ts` `record_decision` description: replace `"ALWAYS call this tool after every decision_request response to record each answered question — never skip or defer."` with wording acknowledging the user toggle.

**Why:** The tool description tells the model what to do before it knows the toggle state. Leaving the "ALWAYS" mandate would conflict with the toggle's "do NOT record" instruction. The toggle supplies the authoritative direction at submission time.

### Decision 5: Multiselect "Other" textarea shown when selected, not only when focused

Change the desc-area template condition in `DecisionRequest.vue` from `v-if="focusedOption[qi] === '__other__'"` to `v-if="isSelected(qi, q, '__other__')"`. The "Other" textarea is always visible when `__other__` is checked, regardless of which option row has focus.

**Why:** Root cause — clicking the "Other" checkbox via `@click.stop` doesn't set `focusedOption`, hiding the textarea and deadlocking `canSubmit`. This fix decouples textarea visibility from focus state.

### Decision 6: `ask_me` removal is registry-level only

Remove from `registry.ts`: the `ask_me` tool definition, `TOOL_GROUPS["interactions"]` membership (leaving `["decision_request"]`), and `TOOL_DESCRIPTIONS` entry. Update `test/tools.test.ts` accordingly.

**Why:** Lowest-risk approach. `ask_me` isn't in any workflow config or default tool set — it's dead. Removing the definition stops the model from being offered it. Deleting `AskUserPrompt.vue` / native ask handling risks breaking shell approval.

### Decision 7: Note tool descriptions use board-tool warning pattern

Prefix `create_note` and `update_note` descriptions with `"⚠️ NOTE TOOL — use ONLY when the user EXPLICITLY asks to create/edit a note. "` mirroring the existing board tool guard pattern.

## Risks / Trade-offs

- **Conflicting instructions when toggle OFF**: The NO_RECORD_INSTRUCTION could be ignored by a model that sees earlier context about recording. → Mitigation: The model receives the instruction at the point of submission (latest user message), which is authoritative in agent loops.
- **`record_decision` description softening may reduce recording discipline**: Without the "ALWAYS" mandate, models might skip recording even when toggle is ON. → Mitigation: The `HIDDEN_INSTRUCTION` in engineContent still mandates recording when the toggle is ON; the tool description is only pre-call guidance.
- **Multiselect fix surface**: Changing `focusedOption` to selection-driven textarea visibility could alter the visual hierarchy when both regular options and "Other" are selected. → Mitigation: Monitoring via e2e tests; the change is minimal (one condition + class binding).
- **Backward incompat of `buildDecisionSubmission` signature**: Existing test callers pass 2 args. → Mitigation: Third parameter is optional with default `true`, all existing tests pass unchanged.
## Testing Strategy

### Decision 8: Extract DecisionRequest logic to testable pure functions

Extract the core validation, answer-formatting, and selection-state logic from `DecisionRequest.vue` into a plain `src/mainview/utils/decisionRequest.ts` module. The component imports and calls these pure functions instead of inlining the logic. This enables direct unit testing with `bun test` (no `.vue` SFC compilation needed — avoids the `@vue/test-utils` + Vite plugin + DOM environment infrastructure gap).

**Why:** The project's primary test runner is `bun test`, which does NOT use Vite's transform pipeline and has no Vue SFC / DOM support. @vue/test-utils would require a separate vitest command with new dependencies (happy-dom/jsdom, @vitejs/plugin-vue reconfiguration). Extracting to `.ts` utilities keeps testing aligned with the existing `bun test` infrastructure while still covering the decision logic (canSubmit, answer formatting, toggle state) in fast unit tests. Component rendering and interaction remain covered by the comprehensive Playwright e2e suite.

**Extracted utilities:**
- `canSubmitDecisionRequest(questions, state)` — per-question validation for all three question types
- `buildDecisionAnswerParts(questions, state)` — formatted `Q:` / `A:` text array
- `buildDecisionAnswers(questions, state)` — structured `DecisionAnswer[]`
- `isOptionSelected(question, title, state)` — selection check
- `buildSubmissionText(questions, state, generalNotes)` — final text composition

**Alternatives considered:**
- @vue/test-utils + vitest → rejected: requires new infra, is incompatible with `bun test`
- E2E only → rejected: slow feedback loop, hard to test validation edge cases in isolation

### Decision 9: Test layers and coverage

The test strategy spans four layers, aligned with existing patterns:

1. **Pure unit tests** (backend): `decision-submission.test.ts` DS-13..DS-19 for `recordAsDecisions: false` behavior, `decision-handlers.test.ts` DH-5..DH-10 for handler-to-helper plumbing.
2. **Pure unit tests** (frontend utility): NEW `utils/decisionRequest.test.ts` DRU-1..DRU-13 covering canSubmit, answer formatting, selection logic.
3. **Store tests**: `task.test.ts` T-SC-5..T-SC-6 and `chat.test.ts` C-14..C-15 verifying `recordAsDecisions` is threaded to RPC via `vi.mock("../rpc")`.
4. **E2E Playwright**: `interview-me.spec.ts` T-P1..T-P3 (toggle rendering + submission payloads) and T-Q1..T-Q3 (multiselect "Other" fix regression).
5. **Tool definition tests**: `common-tools-registration.test.ts` CTR-D-4..CTR-D-9 for description content, `tools.test.ts` for `ask_me` removal and `interactions` group integrity.

No explicit e2e for `ask_me` removal — the registry-level change is fully covered by `tools.test.ts` unit tests.
