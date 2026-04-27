## Why

The `structured-tool-input-validation` change introduces a generic `validateToolArgs` helper, removes `toToolArgs()`, and widens all handler signatures to `Record<string, unknown>`. The existing test suite was written against the old string-args API and contains ad-hoc assertions tied to the hand-written `interview_me` validation block — both will break. A dedicated test suite ensures the new validation logic is correct, the old assertions are migrated accurately, and regressions are caught.

## What Changes

- **NEW**: `src/bun/test/validate-tool-args.test.ts` — unit tests for the `validateToolArgs` helper covering enum violations, missing required fields, type mismatches, multiple errors, and valid pass-through across at least four tool definitions.
- **UPDATED**: `src/bun/test/tasks-tools.test.ts` — args migrated from `{ task_id: String(n) }` style to `{ task_id: n }` (typed); new validation-specific test cases added for `update_todo_status.status` enum and `create_task` required fields.
- **UPDATED**: `src/bun/test/claude-tools.test.ts` — `{ questions: JSON.stringify([...]) }` → `{ questions: [...] }` (real array); ad-hoc error message assertions updated to match AJV-formatted messages.
- **UPDATED**: `src/bun/test/common-tools-registration.test.ts` — same `JSON.stringify` → real array migration.
- **NO Playwright tests** — validation is backend-only; the UI renders error strings identically to any other tool result. No new e2e coverage is needed.

## Capabilities

### New Capabilities

- `engine-tool-input-validation-tests`: Test coverage for the generic `validateToolArgs` helper and the updated `executeCommonTool` validation gate.

### Modified Capabilities

- `engine-common-tools`: Existing tests updated to typed args and new validation scenarios added.
- `engine-interview-common-tool`: Existing ad-hoc validation assertions migrated to AJV-formatted error message expectations.

## Impact

- `src/bun/test/validate-tool-args.test.ts` — **new file**
- `src/bun/test/tasks-tools.test.ts` — args format migration + new validation cases
- `src/bun/test/claude-tools.test.ts` — interview_me args format + error message assertions
- `src/bun/test/common-tools-registration.test.ts` — interview_me args format
