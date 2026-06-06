## 1. Consolidated card tool definitions

- [ ] 1.1 Create `src/bun/engine/card-tool-definitions.ts` with `CARD_TOOL_DEFINITIONS` array containing all card tool definitions (get_card, list_cards, create_card, edit_card, delete_card, move_card, message_card, get_board_summary, list_boards) with proper descriptions including ⚠️ BOARD TOOL warnings
- [ ] 1.2 Export `CARD_TOOL_NAMES` Set from card-tool-definitions.ts
- [ ] 1.3 Add `list_boards` tool definition with empty parameters and description hinting at board discovery

## 2. BoardToolExecutor — add list_boards support

- [ ] 2.1 Add `execListBoards` method to `IBoardToolExecutor` interface in `src/bun/workflow/tools/types.ts`
- [ ] 2.2 Implement `execListBoards` in `BoardToolExecutor` class — query boards table for id + name, return JSON array
- [ ] 2.3 Update error messages in `execGetBoardSummary`, `execListCards`, `execCreateCard` to mention `list_boards` tool

## 3. common-tools.ts — rename + integrate

- [ ] 3.1 Import `CARD_TOOL_DEFINITIONS` from card-tool-definitions.ts into `COMMON_TOOL_DEFINITIONS`
- [ ] 3.2 Rename all switch cases in `executeCommonTool()` to card names (get_card, list_cards, create_card, edit_card, delete_card, move_card, message_card)
- [ ] 3.3 Add `list_boards` case in `executeCommonTool()` that calls `ctx.repos.boardTools.execListBoards()`
- [ ] 3.4 Rename all switch cases in `buildCommonToolDisplay()` to card names
- [ ] 3.5 Add `list_boards` display case in `buildCommonToolDisplay()`
- [ ] 3.6 Update `COMMON_TOOL_NAMES` to use `CARD_TOOL_NAMES`

## 4. registry.ts — rename groups + descriptions

- [ ] 4.1 Import `CARD_TOOL_DEFINITIONS` into `TOOL_DEFINITIONS` in registry.ts
- [ ] 4.2 Rename tool group `tasks_read` to `cards_read` in `TOOL_GROUPS` map
- [ ] 4.3 Rename tool group `tasks_write` to `cards_write` in `TOOL_GROUPS` map
- [ ] 4.4 Update `DEFAULT_TOOL_NAMES` to `["cards_read", "cards_write"]`
- [ ] 4.5 Rename all entries in `TOOL_DESCRIPTIONS` map to card names
- [ ] 4.6 Update `TOOL_GROUP_LABELS` to use cards terminology

## 5. Scripts — rename tool references

- [ ] 5.1 Update `scripts/backfill-tool-call-display.ts` — add card tool name mappings

> **Tests are in a separate change:** `board-card-tools-tests`
> The test suite covers: renaming all tool references, new `list_boards` tests, chat-context board tool tests, error message tests, display label tests, RPC scenario updates.
