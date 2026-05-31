## Context

The `better-claude-tools-display` change introduces new pure functions and modifies existing event translation logic. The existing test files cover the happy path but have specific gaps:

- `src/bun/engine/__tests__/tool-display.test.ts` — has `canonicalToolDisplayLabel` tests; the three new helpers (`stripRailyinMcpPrefix`, `humanizeToolName`, `stripWorktreePath`) are untested
- `src/bun/test/claude-events.test.ts` — covers bare tool names only; no MCP-prefixed cases, no `isInternalClaudeToolName` with prefix, no humanized fallback
- `src/bun/test/opencode-events.test.ts` — `tool_start` assertions exist but never assert the `display` field
- `src/bun/test/copilot-events.test.ts` — focused on `writtenFiles` extraction; no `display.label` assertions
- `e2e/ui/stream-reactivity.spec.ts` — has one tool label test (`bash`); no test for a label containing spaces

All new functions are pure (no DB, no network) so unit tests are sufficient for correctness. Integration tests (in-memory DB path) are not needed — the display field is computed at translation time and passed through as-is. One Playwright test guards against UI regressions when a label contains spaces.

## Goals / Non-Goals

**Goals:**
- Full unit coverage of the three new helpers in `tool-display.ts`
- Cover MCP-prefix normalization path through `translateClaudeMessage` (display routing + `isInternalClaudeToolName`)
- Cover humanized fallback in Claude, Copilot, and common-tools default cases
- Amend existing OpenCode `tool_start` assertions to include `display`
- One Playwright regression test for space-containing labels

**Non-Goals:**
- Integration/DB-layer tests (no schema changes, no new RPC paths)
- Testing Pi display — already well-covered in `pi-event-translator.test.ts`
- End-to-end tests that verify the full backend-to-UI pipeline for MCP tool calls

## Decisions

### Decision: Tests live alongside existing test files, not in a new directory

New cases are added to existing test files where the pattern already exists. No new test files are created except for `tool-display.test.ts` extension (which already lives in `engine/__tests__/`). This keeps the test surface minimal and discoverable.

### Decision: `bun:test` for `engine/__tests__/`, `vitest` for `src/bun/test/`

The project already uses this split. `tool-display.test.ts` is in `engine/__tests__/` and uses `bun:test`. All other new cases go into `src/bun/test/` files and use `vitest`. No new test runner configuration is needed.

### Decision: No refactoring just for testability

All target functions are already pure or directly invocable. No dependency injection, no mock injection, no alternate code paths are needed to make the tests work.

### Decision: Copilot display test uses the existing `MockCopilotSession` stream pattern

The existing `copilot-events.test.ts` already uses `MockCopilotSession` + `translateCopilotStream` to collect `EngineEvent[]`. A new `it` block streams an unknown tool name and asserts `display.label` on the collected `tool_start` event — no new test infrastructure needed.

### Decision: Playwright test feeds a pre-humanized label via mock

The Playwright layer tests the frontend contract (does the UI render a label with spaces correctly?), not the backend normalization. The test pushes a `tool_call` stream event with `display.label = "other-server do thing"` and asserts `.tc__tool-name` contains that text. This is a pure rendering regression test.

## Risks / Trade-offs

- [Test files span two test runners] → Low risk: the split is pre-existing convention; new cases follow it exactly
- [Playwright test verifies rendering contract, not normalization] → Intentional: backend normalization is covered by unit tests; Playwright layer tests only the frontend rendering
