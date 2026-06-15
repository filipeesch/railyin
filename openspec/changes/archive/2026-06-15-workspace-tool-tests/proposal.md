## Why

The `workspace-tool` change introduces two new AI-facing tools (`list_projects` and `list_workflows`) but has no test coverage. Without tests, we risk regressions in tool registration, execution logic, workspace key threading, and board query extraction. Tests provide confidence that the tools work correctly across both chat session and task execution contexts.

## What Changes

- **New unit tests** for tool definitions (schemas, names, descriptions)
- **New unit tests** for tool registration in both Copilot and Claude engine paths
- **New unit tests** for tool execution logic (full project data, board list, empty results)
- **New integration tests** for workspace key threading through `buildForChat()`
- **New integration tests** for board query extraction from `boards.list` RPC handler
- **Extended tests** in `common-tools-registration.test.ts` for the two new tools
- Playwright UI tests are out of scope (handled separately)

## Capabilities

### New Capabilities
- `workspace-tool-tests`: Test coverage for `list_projects` and `list_workflows` tools, including definitions, registration, execution, workspace key threading, and board query refactoring.

### Modified Capabilities
- `workspace-discovery`: Specs from the `workspace-tool` change provide the requirements that these tests validate. This change does not modify the spec — it only adds test artifacts.

## Impact

- `src/bun/test/workspace-tool-definitions.test.ts` — **new** tool definition tests
- `src/bun/test/workspace-tool-execution.test.ts` — **new** tool execution tests
- `src/bun/test/execution-params-builder.test.ts` — **new** tests for workspaceKey threading in chat
- `src/bun/test/boards.test.ts` — **new** tests for extracted `listBoardsByWorkspace` function
- `src/bun/test/common-tools-registration.test.ts` — **extended** with 2 new tool registrations
- `src/bun/db/board-queries.ts` — **new** module (extracted from boards handler) tested by integration tests
