## Context

The `fix-pi-ghost-tools` production change repairs two Pi engine bugs. Both bugs are currently invisible to automated tests: there are no tests for the session reuse path of `getOrCreateSession()`, no tests for the `run_command` description content, and no tests asserting that stale tool names are absent from `context.ts` constants.

The existing test infrastructure provides the DI patterns needed to cover these gaps:
- `TestPiEngine extends PiEngine` (overrides `protected getOrCreateSession`) — already used for compact() tests
- `MockAgentSession` — injectable session double with `compact`, `getContextUsage`, `dispose`
- `buildPiToolDisplay` — a pure function, directly testable without any DI
- `MICRO_COMPACT_CLEARABLE_TOOLS` and `TOOL_RESULT_LIMITS` — plain exports, directly assertable

The only blocker for session reuse tests is that the current `TestPiEngine` overrides `getOrCreateSession()` wholesale — so the real reuse logic (the code being fixed) never runs in tests. A minimal extract-method refactoring unblocks this.

## Goals / Non-Goals

**Goals:**
- Regression-catch the session reuse bug (SDK built-ins must survive turn 2+)
- Regression-catch the ghost description bug (`run_command` must not reference `search_text`)
- Regression-catch the stale constant entries (`MICRO_COMPACT_CLEARABLE_TOOLS`, `TOOL_RESULT_LIMITS`)
- Assert `buildPiToolDisplay` correctness for SDK built-in tool names
- Use DI and subclass injection throughout — never `vi.mock()` or alternate code paths

**Non-Goals:**
- Playwright / UI tests (all fixes are engine-side only)
- Integration tests driving full Pi SDK execution (no real LLM calls)
- Testing `buildAllTools()` column-group filtering (already covered in `tool-registry.test.ts`)

## Decisions

### D-TEST-1 — Extract `protected createNewSession()` to enable session reuse tests

**Problem**: `TestPiEngine` currently overrides `getOrCreateSession()` entirely, injecting a mock and bypassing all reuse logic. This means the `agent.state.tools = tools` bug (and after the fix, `setActiveToolsByName`) runs only in production — never in tests.

**Solution**: Extract session creation into a `protected createNewSession(tools, systemPrompt, workingDir): Promise<AgentSession>` method on `PiEngine`. Tests then override **only this** method to inject a `MockAgentSession`, while `getOrCreateSession()` runs its real logic — including the reuse path being fixed.

```
Before:
  TestPiEngine overrides getOrCreateSession() → returns mock, reuse logic never runs

After:
  TestPiEngine overrides createNewSession() → first call returns mock
  getOrCreateSession() runs for real:
    turn 1 → calls createNewSession() → gets MockAgentSession → stores it
    turn 2 → reuse path runs → setActiveToolsByName() called on mock ← assertable
```

This is a Dependency Inversion refactoring, not a test-only hack. The extracted method is a natural seam.

### D-TEST-2 — Grow `MockAgentSession` with a `setActiveToolsByName` spy

`setActiveToolsByName` is the correct SDK API called on session reuse after the fix. The mock needs to record calls so tests can assert:
- It was called on turn 2 (not turn 1, where it fires at creation time)
- The names passed include all SDK built-in names: `"read"`, `"grep"`, `"find"`, `"ls"`
- `agent.state.tools` assignment does NOT occur (structural — `MockAgentSession` has no `agent` property)

No need to simulate the SDK registry. The spy just records what it was called with.

### D-TEST-3 — `conversation-context.test.ts` is a pure constants assertion file

`MICRO_COMPACT_CLEARABLE_TOOLS` and `TOOL_RESULT_LIMITS` are plain exported constants. The new file:
- Imports them directly
- Asserts `search_text` is absent from both
- Asserts `find_files` is absent from both
- No DB, no engine, no DI needed

File location: `src/bun/test/conversation-context.test.ts` — consistent with all other test files in this directory.

### D-TEST-4 — `buildPiToolDisplay` tests extend `pi-event-translator.test.ts`

`buildPiToolDisplay` is a pure function exported from `pi/tools/display.ts`. It is imported by `event-translator.ts` and is in scope of that test file by proximity. New test cases:
- `"read"` with `file_path` arg → `{ label: "read", subject: ..., contentType: "file" }`
- `"grep"` with `pattern` arg → `{ label: "grep", subject: ..., contentType: "terminal" }`
- `"find"` with `pattern` arg → `{ label: "find", contentType: "terminal" }`
- `"ls"` with `path` arg → `{ label: "ls", contentType: "terminal" }`
- `"search_text"` (removed tool) → falls to default → `buildCommonToolDisplay` result, NOT a Pi-specific label

### D-TEST-5 — `tool-registry.test.ts` gains a description content assertion

The existing file already imports `PI_TOOL_GROUPS`. The `run_command` tool lives in the `shell` group. The new test:
- Calls `buildAllTools()` with `columnGroups: ["shell"]`
- Finds the `run_command` tool
- Asserts `tool.description` does not contain `"search_text"`
- Asserts `tool.description` contains `"grep"` or `"find"`

## Risks / Trade-offs

**[Low Risk] Extract-method refactoring may break the existing compact() tests** → Unlikely. Compact tests override `getOrCreateSession()` and this will continue to work. The refactoring only adds a new protected seam — it does not change existing overridable surface.

**[Low Risk] Two-turn test setup is slightly more complex** → Simulating two sequential executions requires calling `engine.execute()` twice on the same `conversationId` with the same engine instance. This is the same pattern already used for compact testing, just applied to the reuse path.
