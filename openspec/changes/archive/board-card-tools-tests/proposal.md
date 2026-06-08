## Why

The `board-card-tools` change introduces new tools (`list_boards`), renames 7 existing tools (task_* → card_*), and adds new error message patterns. Without comprehensive test coverage, regressions in tool routing, display labels, group membership, and chat-context board tool usage will go undetected. This change establishes the test suite for all feature changes.

## What Changes

- **Rename existing tests** (~40 test assertions): Update all tool name references from `task_*` to `card_*` and group names from `tasks_read`/`tasks_write` to `cards_read`/`cards_write`
- **New `list_boards` tests** (4 tests): Unit tests for the new tool covering success, empty state, and group membership
- **New chat-context board tool tests** (4 tests): Verify board tools work with explicit `board_id` when `ctx.boardId` is null (chat session scenario)
- **New error message tests** (2 tests): Verify board tool errors mention `list_boards` as the discovery tool
- **New `execListBoards` tests** (2 tests): BoardToolExecutor method tests
- **New display label tests** (2 tests): Verify `buildCommonToolDisplay` returns correct labels for card-named tools
- **Update RPC scenario tests** (5 files): Rename tool names in mock step definitions
- **Update tool registry tests** (1 file): Group names and child tool exclusion list

## Capabilities

### New Capabilities
- `card-tools-test-suite`: Comprehensive test coverage for card tool renaming, list_boards, chat-context board tools, and display labels.

### Modified Capabilities
- (None — this is a pure test change with no production requirement modifications)

## Impact

- `src/bun/test/tasks-tools.test.ts` — Primary test file: rename all tool names, add list_boards, add chat-context tests
- `src/bun/test/tool-registry.test.ts` — Group names and child tool exclusion list
- `src/bun/test/claude-rpc-scenarios.test.ts` — Tool name renames in mock steps
- `src/bun/test/copilot-rpc-scenarios.test.ts` — Tool name renames in mock steps
- `src/bun/test/opencode-rpc-scenarios.test.ts` — Tool name renames in mock steps
- `src/bun/test/opencode-events.test.ts` — Tool name renames
- `scripts/backfill-tool-call-display.ts` — Add card tool name mappings
