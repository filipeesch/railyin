## Why

The `rolling-chat-ux-improvements` change fixes 9 UX bugs and decomposes `StreamBlockNode` into single-responsibility components, but ships no automated test coverage. Without tests, the same regressions can silently return. This change adds the complete test suite: backend unit tests (pure functions), backend integration tests (in-memory DB + ScriptedEngine), and Playwright E2E tests (mock API + WS).

## What Changes

- **Update S-18** (`stream-tree-scenarios.test.ts`): the existing test currently asserts the Bug #1 regression (tool call nested under reasoning block). It must be corrected to assert the fixed behavior — tool call is a sibling root, not a child of the reasoning block.
- **New unit tests** (`claude-events.test.ts`, `copilot-events.test.ts`, `common-tools-registration.test.ts`): cover array content normalization, `isInternal` fix for subagent tools, path stripping, edit `startLine` extraction, and `detailedContent` envelope for common tools.
- **New integration tests** (`stream-tree-scenarios.test.ts`, `stream-pipeline-scenarios.test.ts`): verify the fixed parentBlockId propagation in both IPC (live) and DB (persisted) paths using ScriptedEngine checkpoints.
- **New Playwright E2E tests** across `conversation-body.spec.ts`, `stream-reactivity.spec.ts`, `tool-rendering.spec.ts`, and `interview-me.spec.ts`: cover all 9 frontend UX fixes end-to-end with mock API/WebSocket.

## Capabilities

### New Capabilities
- `rolling-chat-ux-test-suite`: Comprehensive test coverage (unit + integration + E2E) for all 9 bug fixes and the ToolCallBlock component decomposition introduced by `rolling-chat-ux-improvements`

### Modified Capabilities

## Impact

- **Test files added/updated**: `src/bun/test/claude-events.test.ts`, `src/bun/test/copilot-events.test.ts`, `src/bun/test/common-tools-registration.test.ts`, `src/bun/test/stream-tree-scenarios.test.ts` (S-18 update), `src/bun/test/stream-pipeline-scenarios.test.ts`
- **Playwright specs added**: `e2e/ui/conversation-body.spec.ts`, `e2e/ui/stream-reactivity.spec.ts`, `e2e/ui/tool-rendering.spec.ts`, `e2e/ui/interview-me.spec.ts`
- **No production code changes**: this change is test-only; all refactoring for testability (options-bag on `translateCopilotStream`) is done as part of `rolling-chat-ux-improvements`
- **Dependency**: must be applied after `rolling-chat-ux-improvements` is fully implemented
