## Why

The `better-claude-tools-display` change introduces three new pure helpers (`stripRailyinMcpPrefix`, `humanizeToolName`, `stripWorktreePath`), patches `isInternalClaudeToolName`, and wires `display` into the OpenCode event translator. None of these changes are covered by tests today. Without a test suite, regressions in MCP prefix stripping, humanization edge cases, or the internal-tool filter are invisible until they appear in the UI.

## What Changes

- **New unit tests for `tool-display.ts`**: cover `stripRailyinMcpPrefix`, `humanizeToolName`, `stripWorktreePath` as pure functions
- **Extended Claude event tests**: cover MCP-prefixed display routing, `isInternalClaudeToolName` with prefixed names, and the humanized fallback for unknown tools
- **Extended OpenCode event tests**: amend existing `tool_start` assertions to include `display`, add cases for common tools and unknown tool humanization
- **New Copilot event test**: verify the unknown-tool default case is humanized (underscores → spaces)
- **New Playwright test**: verify the UI renders a humanized label containing spaces correctly (regression guard for `tc__tool-name` element)

## Capabilities

### New Capabilities
- `tool-display-test-coverage`: Unit and UI test contracts for `stripRailyinMcpPrefix`, `humanizeToolName`, `stripWorktreePath`, MCP-prefixed Claude display routing, OpenCode display wiring, Copilot humanization fallback, and Playwright label rendering

### Modified Capabilities
