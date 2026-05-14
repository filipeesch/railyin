## Context

The `decision_request` feature is a multi-path system where models (Claude, Copilot, Pi engine) interact through structured interviews. The feature has excellent coverage for Claude and Copilot paths, but the Pi engine path — which is where the JSON string serialization bug originally manifested — lacks equivalent tests.

Current test architecture:
- **Unit tests** (`src/bun/test/`): Individual module tests using Bun's built-in test runner
- **Integration tests** (`src/bun/test/integration/`): `ScriptedEngine` pattern for testing SDK pipelines
- **E2E UI tests** (`e2e/ui/`): Playwright tests with API mocking

The `ScriptedEngine` pattern (in `src/bun/test/support/scripted-engine.ts`) provides a checkpoint protocol that allows tests to pause execution at arbitrary points and assert on both IPC and DB channels independently. This is the pattern used for Claude and Copilot SDK path tests.

## Goals / Non-Goals

**Goals:**
- Cover the Pi engine `decision_request` pipeline using the same `ScriptedEngine` pattern
- Test `normalizeArgs` as a standalone, schema-driven function
- Test stream processor's `decision_request` event → message creation
- Test `executeCommonTool` edge cases with string-encoded arguments
- Test chat store state transition for `decision_request_prompt`
- Cover edge cases: malformed JSON, empty arrays, missing fields, nested string encoding
- Extend Playwright tests for streaming, concurrency, and reconnection scenarios

**Non-Goals:**
- Test coverage for non-decision_request features (this is a focused test expansion)
- Changes to production code (tests should only import and exercise existing functionality)
- Playwright Golden image tests (already covered by existing suite)
- Performance benchmarks (out of scope for bug regression prevention)

## Decisions

### 1. Use the existing ScriptedEngine pattern for Pi engine tests

`ScriptedEngine` provides a proven checkpoint protocol for testing agent pipelines. Tests can pause at any point and assert on IPC events and DB state independently.

**Why ScriptedEngine over a raw agent?**
- Simpler test setup — no real LLM calls, no MCP servers, no DB migrations
- Deterministic — exact events can be scripted in exact order
- Independent API assertions — test IPC and DB channels independently

**Alternative considered:** Raw agent with mocked LLM → Higher complexity, less deterministic.

### 2. Extract normalizeArgs into a standalone testable module

The `normalizeArgs` function must be independently unit-testable. This requires extracting it from `buildCommonTools()` into `src/bun/engine/normalize-args.ts`.

**Why a separate module?**
- Pure function: takes `(schema, rawArgs)` → returns normalized args
- Testable in isolation without mocking Pi SDK internals
- Overridable for tests: tests can pass custom schemas to verify edge cases

### 3. Use seed data from existing test fixtures

The existing test files (`decision-handlers.test.ts`, `common-tools-registration.test.ts`) already have seed functions for workspace and task creation in the DB. Reuse these patterns rather than creating new fixtures.

**Why:** Less duplication, consistent test data patterns, less test maintenance overhead.

### 4. Test edge cases through executeCommonTool, not through the model

To test string-encoded arguments, we call `executeCommonTool` directly with string values for `questions`. This reproduces the bug without needing to mock the LLM model's output.

**Why direct calls over model simulation?**
- Faster tests — no SDK overhead
- Precise control — exact bad data can be injected
- Covers AJV validation layer directly

### 5. Playwright extension via API mocking

Extend `interview-me.spec.ts` with edge cases using the existing `makeUserMessage()` and `makeInterviewPrompt()` helpers, plus API mock intercepts for streaming and reconnection scenarios.

**Why extension over new file?**
- Existing file already has the full test harness set up
- New tests can share helpers and fixtures
- Keeps related tests co-located for maintainability

## Risks / Trade-offs

| Risk | Mitigation |
|---|---|
| Tests depend on normalizeArgs PR being merged first | Tests are written for the *target* architecture (normalizedArgs as standalone module). The implementation tasks will be ordered so that module creation comes first |
| ScriptedEngine pattern complexity for new contributors | Pattern is well-documented in existing tests (pi-sdk-tool-events.test.ts). Follow the exact same pattern |
| Playwright tests adding flakiness due to streaming edge cases | Streaming tests use fixed mock data and controlled delays; concurrency tests use separate page instances |
| Test files growing too large | Each test file stays under 200 lines by splitting into focused describe blocks |
