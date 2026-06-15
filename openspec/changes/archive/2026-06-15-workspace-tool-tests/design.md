## Context

The `workspace-tool` change introduces two new AI-facing tools without test coverage. The existing test infrastructure (`helpers.ts` with `initDb()`, `setupTestConfig()`, `seedChatSession()`) and patterns (`common-tools-registration.test.ts`, `project-registration-paths.test.ts`, `board-tool-executor.test.ts`) provide a clear blueprint for test creation. No new test dependencies or infrastructure changes are needed.

## Goals / Non-Goals

**Goals:**
- Full unit test coverage for tool definitions (schemas, names, descriptions)
- Full unit test coverage for tool execution logic (projects from YAML, boards from DB)
- Integration tests for workspace key threading through chat execution
- Integration tests for board query extraction refactoring
- Extend existing `common-tools-registration.test.ts` with the two new tools
- Playwright tests are out of scope

**Non-Goals:**
- Playwright UI tests (handled separately per user direction)
- Mutation testing (Stryker, handled separately)
- New test infrastructure or test helpers
- Testing MCP tool integration (out of scope for this feature)

## Decisions

### 1. Single test file per concern, following existing patterns
```
workspace-tool-definitions.test.ts  → definition schemas, names, descriptions
workspace-tool-execution.test.ts    → tool execution with in-memory DB
execution-params-builder.test.ts     → workspaceKey threading (append to existing)
boards.test.ts                       → listBoardsByWorkspace extraction (append to existing)
common-tools-registration.test.ts    → registration in Copilot/Claude engines (append)
```
**Why:** Matches the existing pattern in `src/bun/test/`. Each file groups related tests. Extending existing files (`execution-params-builder.test.ts`, `boards.test.ts`, `common-tools-registration.test.ts`) avoids duplication.

### 2. Use `setupTestConfig()` + `initDb()` from helpers
**Why:** The existing helpers already create temp config dirs with workspace.yaml, engines.yaml, workflow files, and in-memory DBs. `seedChatSession()` is available for chat-specific tests. No need to create new test fixtures.

### 3. Board query extracted to `src/bun/db/board-queries.ts`
**Why:** Testing the extraction requires a module that can be imported and called independently of the RPC handler. A dedicated file in `src/bun/db/` follows the existing pattern of `task-git-context-repository.ts`, `note-repository.ts`, `decision-repository.ts`.

### 4. Integration tests live in `src/bun/test/` (not `integration/`)
**Why:** The `src/bun/test/integration/` directory has only one file (`pi-sdk-tool-events.test.ts`). Most "integration" tests (with DB + config) live directly in `src/bun/test/`. The `workspace-tool-tests` follow this pattern.

## Risks / Trade-offs

| Risk | Mitigation |
|------|-----------|
| Board query extraction changes `boards.list` response shape | Extraction is pure — function signature and return type are identical. Tests verify no regression. |
| Test file count grows | Only 4 new files, 3 existing files extended. Total ~7 test files for 2 tools — reasonable ratio. |
| `setupTestConfig()` creates temp dirs per test | Existing tests already use this pattern. OS temp cleanup handles it. |

## Migration Plan

No migration needed. Tests run against existing codebase:
1. Implement `workspace-tool` change first (provides the code to test)
2. Run tests with `bun test src/bun/test/workspace-tool*` — all pass
3. Archive both changes together

## Open Questions

None. All testing approach decisions grounded in existing patterns.
