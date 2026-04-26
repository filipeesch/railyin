## 1. Backend — Fix Claude MCP Schema Translation

- [x] 1.1 Extend `ZodLike` type in `src/bun/engine/claude/tools.ts` to add `array`, `object`, and `enum` method signatures
- [x] 1.2 Extend `schemaPropToZod` to handle `type: "array"` → `z.array(recursiveItem)`, `type: "object"` → `z.object(recursiveShape)`, and `type: "string"` with `enum` → `z.enum([...])`
- [x] 1.3 Verify with a runtime test that `interview_me`'s MCP `tools/list` entry now includes `type: "array"` with full `items` schema for `questions`

## 2. Backend — Defensive Type Normalization

- [x] 2.1 In `src/bun/engine/common-tools.ts`, add type normalization for `interview_me` questions before calling `ctx.onInterviewMe` — map any unrecognized `type` value to `"exclusive"` (matching `workflow/engine.ts` pattern)

## 3. Frontend — Fix non_exclusive Row-Click

- [x] 3.1 In `src/mainview/components/InterviewMe.vue`, update `onRowClick` to call `onCheckboxClick(qi, q, title)` when `q.type === 'non_exclusive'`, so row click toggles `multiSelected` in addition to updating `focusedOption`

## 4. Frontend — Reactive State Re-init Guard

- [x] 4.1 In `InterviewMe.vue`, add a `watch(() => props.questions, ...)` that resets `singleSelected`, `multiSelected`, `freetextValues`, `otherValues`, `notesValues`, and `focusedOption` to fresh empty arrays when `questions` prop changes after mount

## 5. Playwright Tests

- [x] 5.1 Create `e2e/ui/interview-me.spec.ts` with test T-A: render exclusive question, click option row, assert Submit enabled
- [x] 5.2 Add test T-B: render non_exclusive question, click option row, assert Submit enabled
- [x] 5.3 Add test T-C: render freetext question, type answer → Submit enabled; clear → Submit disabled
- [x] 5.4 Add test T-D: render two-question batch, answer only first → Submit disabled; answer second → Submit enabled
- [x] 5.5 Add test T-E: answer all questions and click Submit, assert `tasks.sendMessage` API call is made with formatted Q/A string
- [x] 5.6 Add test T-F: seed `interview_prompt` message followed by a `user` message, assert widget renders read-only (no Submit button)
- [x] 5.7 Add test T-G: seed `interview_prompt` → `user` → `assistant` messages, assert widget still renders read-only
- [x] 5.8 Run `bun run build && npx playwright test e2e/ui/interview-me.spec.ts` and confirm all 9 tests pass
