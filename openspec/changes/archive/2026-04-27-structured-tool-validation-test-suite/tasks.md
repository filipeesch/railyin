## 1. Pre-flight

- [ ] 1.1 Confirm `structured-tool-input-validation` is merged and the feature branch is green (`bun test src/bun/test --timeout 20000`)

## 2. Fix interview_me schema gap

- [ ] 2.1 Add `minItems: 1` to the `questions` array in `INTERVIEW_ME_TOOL_DEFINITION` in `src/bun/engine/interview-tool-definition.ts` so AJV rejects empty arrays (regression guard for the old ad-hoc check)

## 3. New unit test file

- [ ] 3.1 Create `src/bun/test/validate-tool-args.test.ts` with unit tests for the `validateToolArgs` helper:
  - V-1: `lsp.operation` invalid enum → string mentions invalid value and valid ops
  - V-2: `update_todo_status.status` invalid enum (`"finished"`) → string mentions valid values
  - V-3: `get_task` missing `task_id` → string mentions field name
  - V-4: `create_task` missing `title` + `description` → both fields mentioned
  - V-5: `interview_me` `questions: "not-an-array"` → type mismatch error
  - V-6: `interview_me` `questions[0].type: "single_choice"` → nested enum error
  - V-7: valid `get_task` args → returns `null`
  - V-8: valid `interview_me` args → returns `null`
  - V-9: two violations simultaneously → both errors in returned string
  - V-10: every definition in `COMMON_TOOL_DEFINITIONS` called with `{}` → none throw (schema compilation guard)

## 4. Update tasks-tools.test.ts

- [ ] 4.1 Migrate string-typed numeric args to typed values (e.g. `{ task_id: String(n) }` → `{ task_id: n }`) throughout `src/bun/test/tasks-tools.test.ts`
- [ ] 4.2 Add validation-integration cases:
  - T-V1: `get_task` with `task_id: "42"` → validation error (type mismatch)
  - T-V2: `update_todo_status` with `status: "finished"` → enum error
  - T-V3: `update_todo_status` with `status: "done"` → succeeds
  - T-V4: `create_task` missing required `title` → validation error before DB write
  - T-V5: `reorganize_todos` with real array `[{ id, number }]` → succeeds

## 5. Update claude-tools.test.ts

- [ ] 5.1 Replace `{ questions: JSON.stringify([...]) }` with `{ questions: [...] }` for all `interview_me` calls in `src/bun/test/claude-tools.test.ts`
- [ ] 5.2 Update error message assertions to use broad regex matchers (e.g. `toMatch(/questions/)` instead of exact strings tied to the old ad-hoc messages)
- [ ] 5.3 Add case: `questions: []` → validation error mentioning `questions` (minItems guard)

## 6. Update common-tools-registration.test.ts

- [ ] 6.1 Replace `{ questions: JSON.stringify([...]) }` with `{ questions: [...] }` in `src/bun/test/common-tools-registration.test.ts`
- [ ] 6.2 Update the `"questions is missing"` assertion to match the AJV-formatted error (`toMatch(/questions/)`)

## 7. Run and verify

- [ ] 7.1 Run `bun test src/bun/test/validate-tool-args.test.ts --timeout 20000` — all new tests pass
- [ ] 7.2 Run `bun test src/bun/test --timeout 20000` — full suite green, no regressions
