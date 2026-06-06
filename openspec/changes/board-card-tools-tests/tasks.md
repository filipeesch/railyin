## 1. Rename tool names in tasks-tools.test.ts

- [ ] 1.1 Rename `get_task` → `get_card` in all test names and `executeCommonTool` calls
- [ ] 1.2 Rename `list_tasks` → `list_cards` in all test names and calls
- [ ] 1.3 Rename `create_task` → `create_card` in all test names and calls
- [ ] 1.4 Rename `edit_task` → `edit_card` in all test names and calls
- [ ] 1.5 Rename `delete_task` → `delete_card` in all test names and calls
- [ ] 1.6 Rename `move_task` → `move_card` in all test names and calls
- [ ] 1.7 Rename `message_task` → `message_card` in all test names and calls
- [ ] 1.8 Update `TOOL_GROUPS` assertions: `tasks_read` → `cards_read`, `tasks_write` → `cards_write`
- [ ] 1.9 Update `TOOL_GROUPS` expected arrays with card tool names
- [ ] 1.10 Run `bun test src/bun/test/tasks-tools.test.ts` to verify all renames pass

## 2. New list_boards tests in tasks-tools.test.ts

- [ ] 2.1 Add test: `list_boards` returns [{id, name}] for seeded boards
- [ ] 2.2 Add test: `list_boards` returns [] when no boards exist
- [ ] 2.3 Add test: `list_boards` is in `cards_read` group

## 3. New chat-context board tool tests in tasks-tools.test.ts

- [ ] 3.1 Add test: `list_cards` succeeds with explicit `board_id` in chat context
- [ ] 3.2 Add test: `create_card` succeeds with explicit `board_id` in chat context
- [ ] 3.3 Add test: `get_board_summary` succeeds with explicit `board_id` in chat context
- [ ] 3.4 Add test: `create_card` error mentions `list_boards` when board_id missing in chat context
- [ ] 3.5 Add test: `list_cards` error mentions `list_boards` when board_id missing in chat context

## 4. New display label tests in tasks-tools.test.ts

- [ ] 4.1 Add test: `create_card` display label is "create card"
- [ ] 4.2 Add test: `get_card` display label is "get card"
- [ ] 4.3 Add test: `list_boards` display label is "list boards"

## 5. Rename tool names in tool-registry.test.ts

- [ ] 5.1 Rename `tasks_read` → `cards_read`, `tasks_write` → `cards_write` in group name assertions
- [ ] 5.2 Rename child tool exclusion list: all `task_*` → `card_*` names
- [ ] 5.3 Add `list_boards` to child tool exclusion list

## 6. Rename tool names in RPC scenario tests

- [ ] 6.1 Update `claude-rpc-scenarios.test.ts`: `create_task` → `create_card`, `edit_task` → `edit_card`
- [ ] 6.2 Update `copilot-rpc-scenarios.test.ts`: `create_task` → `create_card`, `edit_task` → `edit_card`
- [ ] 6.3 Update `opencode-rpc-scenarios.test.ts`: `create_task` → `create_card`, `edit_task` → `edit_card`
- [ ] 6.4 Update `opencode-events.test.ts`: `move_task` → `move_card`

## 7. Update scripts

- [ ] 7.1 Update `scripts/backfill-tool-call-display.ts`: add card tool name mappings

## 8. Final validation

- [ ] 8.1 Run `bun test src/bun --timeout 20000` to verify all tests pass
- [ ] 8.2 Run `bun test src/bun/test/tasks-tools.test.ts` for focused verification
- [ ] 8.3 Run `bun test src/bun/test/tool-registry.test.ts` for registry verification
