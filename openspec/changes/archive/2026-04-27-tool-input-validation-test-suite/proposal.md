## Why

The `structured-tool-input-validation` change introduces `validateToolArgs`, removes `toToolArgs()`, and widens all handler signatures from `Record<string, string>` to `Record<string, unknown>`. These changes break every existing test that passes stringified args. Additionally, the generic validator and the new `minItems: 1` / status-enum constraints need dedicated coverage that doesn't exist yet.

This proposal captures all test work as a separate concern: existing tests to migrate, new unit tests for the validator, and the gap analysis that confirms no Playwright tests are needed.

## What Changes

- **NEW**: `src/bun/test/validate-tool-args.test.ts` — pure unit test suite for the `validateToolArgs` helper: enum violations, missing required, type mismatches, multiple errors, and valid pass-throughs across at least 4 tool definitions.
- **UPDATED**: `src/bun/test/tasks-tools.test.ts` — all `Record<string, string>` arg patterns migrated to typed values (`{ task_id: taskId }` instead of `{ task_id: String(taskId) }`); new scenarios for validation-gate behaviour (invalid enum, wrong type, missing required).
- **UPDATED**: `src/bun/test/claude-tools.test.ts` — `questions: JSON.stringify([...])` calls replaced with `questions: [...]` (real arrays); error assertion regexes updated to match AJV-formatted messages; `toToolArgs`-removal smoke tests added.
- **UPDATED**: `src/bun/test/common-tools-registration.test.ts` — `questions: JSON.stringify([...])` replaced with typed arrays; assertion strings updated.
- **NO new Playwright tests** — validation is backend-only. The UI renders whatever the model receives; bad-input error strings are indistinguishable from other tool results in the UI.

## Capabilities

### New Capabilities

- `tool-input-validation-coverage`: Test coverage for the generic `validateToolArgs` helper and for the validation gate in `executeCommonTool`, ensuring all tool definitions pass AJV schema compilation and that invalid inputs are rejected with descriptive messages.

### Modified Capabilities

- `engine-tool-input-validation`: Adds test scenarios from the spec that were not yet verified: `minItems: 1` on `interview_me.questions`, `update_todo_status.status` enum, `reorganize_todos` native array handling.
- `engine-common-tools`: Test migration — typed args pattern replaces stringified args throughout.
- `engine-interview-common-tool`: Updated assertions for AJV-formatted error messages; replaces ad-hoc message string checks.

## Impact

- `src/bun/test/validate-tool-args.test.ts` — **new file**
- `src/bun/test/tasks-tools.test.ts` — arg migration + new validation scenarios
- `src/bun/test/claude-tools.test.ts` — arg migration + assertion updates + smoke tests
- `src/bun/test/common-tools-registration.test.ts` — arg migration + assertion updates
- No production code changes (test-only proposal)
