## 1. Pre-flight

- [x] 1.1 Merge `origin/main` into this branch and resolve any conflicts

## 2. Dependencies

- [x] 2.1 Add `ajv` as a direct dependency and `@types/json-schema` as a devDependency in `package.json`, then run `bun install`

## 3. Type widening

- [x] 3.1 Change `AIToolDefinition.parameters` in `src/bun/ai/types.ts` to be typed as `JSONSchema7` from `@types/json-schema`

## 4. Validator

- [x] 4.1 Create `src/bun/engine/validate-tool-args.ts` with the `validateToolArgs(def, args)` helper using AJV; return `null` on valid, descriptive error string on failure (enum, required, type-mismatch messages)

## 5. Schema improvements

- [x] 5.1 Add explicit `enum: ["pending", "in-progress", "done", "blocked", "deleted"]` to `update_todo_status.status` in `src/bun/engine/common-tools.ts`; add `minItems: 1` to `interview_me.questions` in `src/bun/engine/interview-tool-definition.ts`; remove the `JSON.parse` fallback from the `reorganize_todos` handler (items arrive as typed array post-refactor)

## 6. Remove toToolArgs and duplicate code

- [x] 6.1 Delete the duplicate code block (lines 157–306) from `src/bun/engine/claude/tools.ts`
- [x] 6.2 Remove `toToolArgs()` from `src/bun/engine/claude/tools.ts` and pass raw SDK args directly to `executeCommonTool`
- [x] 6.3 Remove `toToolArgs()` from `src/bun/engine/copilot/tools.ts` and pass raw args directly to `executeCommonTool`

## 7. Handler signature widening

- [x] 7.1 Change all board tool handler signatures in `src/bun/workflow/tools/board-tools.ts` from `Record<string, string>` to `Record<string, unknown>`, updating `parseInt(args.x, 10)` to `args.x as number` throughout
- [x] 7.2 Change `executeLspTool` signature in `src/bun/workflow/tools/lsp-tools.ts` from `Record<string, string | number>` to `Record<string, unknown>`
- [x] 7.3 Change `executeCommonTool` and all inline todo/lsp handlers in `src/bun/engine/common-tools.ts` to `Record<string, unknown>`

## 8. Validation gate

- [x] 8.1 Add `validateToolArgs` call at the top of `executeCommonTool` in `src/bun/engine/common-tools.ts`; remove the existing ad-hoc `interview_me` validation block; return early with the error string on failure

## 9. Test updates

- [x] 9.1 Update `src/bun/test/tasks-tools.test.ts` to pass typed args (e.g. `{ number: 10 }` instead of `{ number: "10" }`)
- [x] 9.2 Update `src/bun/test/claude-tools.test.ts` to pass real arrays for `questions` instead of `JSON.stringify([...])`
- [x] 9.3 Update `src/bun/test/common-tools-registration.test.ts` to pass typed args

## 10. New tests

- [x] 10.1 Create `src/bun/test/validate-tool-args.test.ts` with unit tests for the generic validator: enum violation, missing required, type mismatch, multiple errors, and valid pass-through — covering at least `lsp`, `update_todo_status`, `get_task`, and `interview_me`
- [x] 10.2 Run the full backend test suite (`bun test src/bun/test --timeout 20000`) and confirm all tests pass
