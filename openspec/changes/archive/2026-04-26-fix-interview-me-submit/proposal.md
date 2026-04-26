## Why

The `interview_me` submit button is permanently disabled in the Claude Code engine, making the deliberation UI completely unusable: users fill all fields but can never submit. Two compounding bugs cause this — a schema translation gap that causes Claude to send invalid question `type` values, and a `non_exclusive` row-click UX gap that prevents `multiSelected` from being populated.

## What Changes

- Fix `jsonSchemaToZodShape` in `src/bun/engine/claude/tools.ts` to recursively handle `type: "array"`, `type: "object"`, and `enum` constraints — so Claude receives a fully-typed MCP inputSchema for `interview_me` and all other array/object tools
- Fix `onRowClick` in `src/mainview/components/InterviewMe.vue` to also toggle `multiSelected` for `non_exclusive` questions, making row-click consistent with `exclusive` behavior
- Add defensive type normalization in `src/bun/engine/common-tools.ts` for `interview_me` question types (like `workflow/engine.ts` already does)
- Add `watch` re-initialization in `InterviewMe.vue` to sync reactive state arrays when `props.questions` changes after mount
- Add `e2e/ui/interview-me.spec.ts` with 7 Playwright test cases covering all question types, submit gating, send behavior, and read-only answered state

## Capabilities

### New Capabilities
- `interview-me-playwright-coverage`: E2e Playwright tests for the InterviewMe widget covering all question types, submit gating, and answered read-only state

### Modified Capabilities
- `interview-me-tool`: Submit gating behavior fixed — `non_exclusive` row click now toggles selection; freetext/exclusive behavior unchanged
- `engine-interview-common-tool`: Type normalization added for Claude engine path
- `claude-engine`: `jsonSchemaToZodShape` extended to handle nested `array` and `object` JSON Schema types so Claude receives full parameter schemas

## Impact

- `src/bun/engine/claude/tools.ts` — extends `ZodLike`, `schemaPropToZod`, and `jsonSchemaToZodShape` to support recursive array/object/enum types
- `src/bun/engine/common-tools.ts` — adds question type normalization in the `interview_me` case
- `src/mainview/components/InterviewMe.vue` — fixes `onRowClick` for `non_exclusive`; adds `watch` re-init guard
- `e2e/ui/interview-me.spec.ts` — new test file (no existing test coverage for this widget)
- No API contract changes; no breaking changes to `InterviewPayload` or `InterviewQuestion` types
