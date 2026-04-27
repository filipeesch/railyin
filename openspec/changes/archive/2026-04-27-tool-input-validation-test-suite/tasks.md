# Tasks

## Group 1 — New unit test file: validate-tool-args.test.ts

- [x] 1.1 Create `src/bun/test/validate-tool-args.test.ts` with pure imports only (`validateToolArgs`, `COMMON_TOOL_DEFINITIONS`, `Ajv`) — no DB setup, no context
- [x] 1.2 Write scenarios V-1 through V-5: enum violation, missing required, type mismatch, multiple errors, valid null return (use `update_todo_status` and `get_task` definitions)
- [x] 1.3 Write scenarios V-6 through V-10: `interview_me` valid, invalid type enum, empty questions array; `reorganize_todos` real array valid, stringified array fails
- [x] 1.4 Write scenario V-11: meta-test — loop over every definition in `COMMON_TOOL_DEFINITIONS`, call `new Ajv().compile(def.parameters)`, expect no throw
- [x] 1.5 Write scenarios V-12 / V-13: null args and non-object args return error without throw
- [x] 1.6 Run `bun test src/bun/test/validate-tool-args.test.ts --timeout 20000` — all tests green

## Group 2 — Migrate tasks-tools.test.ts to typed args

- [x] 2.1 Replace all `String(taskId)` / `String(id)` arg patterns with bare numeric values: `{ task_id: taskId }`, `{ id: id }`
- [x] 2.2 Replace all `{ number: "10" }` and similar stringified numeric fields with real numbers
- [x] 2.3 Replace `{ items: JSON.stringify([...]) }` with `{ items: [...] }` in `reorganize_todos` tests
- [x] 2.4 Add new integration scenario: `executeCommonTool("update_todo_status", { id: 1, status: "finished" }, ctx)` → text MATCHES `/finished/`, DB record unchanged
- [x] 2.5 Run `bun test src/bun/test/tasks-tools.test.ts --timeout 20000` — all existing tests pass plus new scenario

## Group 3 — Migrate claude-tools.test.ts

- [x] 3.1 Replace `questions: JSON.stringify([...])` with `questions: [...]` in all `interview_me` test calls
- [x] 3.2 Update assertion strings from exact toBe comparisons to toMatch regex patterns (e.g. `toMatch(/single_choice/)`, `toMatch(/exclusive|non_exclusive|freetext/)`)
- [x] 3.3 Add smoke test: confirm `interview_me` with `type: "single_choice"` is rejected; confirm `type: "exclusive"` with complete options passes gate and invokes callback
- [x] 3.4 Add scenario: `interview_me` with `questions: []` is rejected with text MATCHING `/questions/` and MATCHING `/minItems|at least 1/i`
- [x] 3.5 Verify ZodLike-related spy tests are UNCHANGED (do not touch schema registration assertions)
- [x] 3.6 Run `bun test src/bun/test/claude-tools.test.ts --timeout 20000` — all green

## Group 4 — Migrate common-tools-registration.test.ts

- [x] 4.1 Replace `questions: JSON.stringify([...])` with `questions: [...]`
- [x] 4.2 Update any exact error-message assertions to regex matchers
- [x] 4.3 Run `bun test src/bun/test/common-tools-registration.test.ts --timeout 20000` — all green

## Group 5 — Full suite run and clean-up

- [x] 5.1 Run `bun test src/bun/test --timeout 20000` — full suite green (expected pre-existing failures: Claude adapter shell binary filter test, Copilot cancellation race test)
- [x] 5.2 Grep for residual `String(` and `JSON.stringify(` usages in test files and resolve any remaining instances
