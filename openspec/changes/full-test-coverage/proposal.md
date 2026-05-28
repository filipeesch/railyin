## Why

The `decision_request` feature has extensive unit and integration tests for the Claude and Copilot agent paths, but several critical test gaps remain:

1. **No Pi engine decision_request pipeline test** — Claude and Copilot have canonical path tests via `ScriptedEngine`, but the Pi engine's path (which is where the JSON string bug originates) lacks equivalent tests.
2. **No tests for the normalizeArgs refactoring** — The normalizedArgs function must be independently testable to validate that string-encoded JSON parameters from models like Qwen are correctly parsed.
3. **No integration test for the stream processor decision_request event** — The flow from `decision_request` event → `decision_request_prompt` message creation → conversation buffer → IPC is untested.
4. **No endpoint coverage for edge cases** — Malformed JSON, empty arrays, missing required fields, and invalid enums for `executeCommonTool` with serialized string args.
5. **No Playwright / UI tests for edge cases** — The interview-me.spec.ts covers happy paths but needs edge cases: streaming to completion, concurrent requests, reconnection handling.

These gaps leave the decision_request feature vulnerable to regressions in the Pi engine path and make it difficult to safely refactor the codebase.

## What Changes

- Create comprehensive unit tests for the `normalizeArgs` module (schema-driven JSON string parsing, deep recursion, error handling)
- Create Pi engine integration tests using `ScriptedEngine` pattern (decision_request event emission, suspend loop, decision_request_prompt message creation)
- Create stream processor integration tests (decision_request event → message creation)
- Create `executeCommonTool` edge case tests (string-encoded args, malformed JSON, nested string encoding)
- Create `decision-handlers` edge case tests (multi-answer submission, long notes, empty answers)
- Create chat store integration tests (decision_request_prompt → waiting_user transition)
- Extend Playwright tests with edge cases (stream completion, concurrent requests, reconnection handling)

**No new features are introduced.** This change covers existing functionality with comprehensive test coverage to prevent regressions and enable safe refactoring.

## Capabilities

### New Capabilities
- `pi-engine-test-coverage`: Tests for the Pi engine's decision_request pipeline using ScriptedEngine
- `edge-case-test-coverage`: Tests for edge cases across the decision_request feature

### Modified Capabilities
- _(none — existing test coverage extends but no spec-level requirements change)_

## Impact

- **New test files:** `src/bun/test/normalize-args.test.ts`, `src/bun/test/pi-decision-request.test.ts`, `src/bun/test/stream-processor-decision-request.test.ts`, `src/bun/test/decision-edge-cases.test.ts`
- **Updated test files:** `src/bun/test/decision-handlers.test.ts`, `e2e/ui/interview-me.spec.ts`
- Existing tests remain unchanged and should continue to pass.
- No changes to application code.
- No changes to API contracts, database schemas, or production behavior.
