## 1. Define Constants and Clearable Tool Set

- [x] 1.1 Add `MICRO_COMPACT_TURN_WINDOW` constant (default: 8) to `engine.ts`
- [x] 1.2 Add `MICRO_COMPACT_CLEARABLE_TOOLS` constant (Set of tool names: `read_file`, `run_command`, `search_text`, `find_files`, `fetch_url`, `patch_file`) to `engine.ts`

## 2. Implement Inline Decay in compactMessages()

- [x] 2.1 In `compactMessages()`, after resolving the post-compaction-summary messages to process, count assistant turn boundaries to assign a turn index to each message
- [x] 2.2 Determine the current maximum turn index and compute each message's turn distance from the most recent turn
- [x] 2.3 When assembling a `tool_result` message whose tool name is in `MICRO_COMPACT_CLEARABLE_TOOLS` and whose turn distance exceeds `MICRO_COMPACT_TURN_WINDOW`, replace its content in the assembled `AIMessage` with the sentinel string `[tool result cleared — content no longer in active context]`
- [x] 2.4 Ensure the sentinel replacement only affects the assembled payload — no DB writes

## 3. Update Token Estimation for Auto-Compact Check

- [x] 3.1 Where context token count is estimated for auto-compact threshold checking (in `engine.ts`), ensure the estimate uses the output of `compactMessages()` (post-decay) rather than raw stored message sizes

## 4. Tests

- [x] 4.1 Add a unit test in `engine.test.ts` verifying that tool results older than `MICRO_COMPACT_TURN_WINDOW` turns are cleared in the assembled output
- [x] 4.2 Add a test verifying that tool results within the window are preserved
- [x] 4.3 Add a test verifying that non-clearable tool results (e.g., `ask_me`) are always preserved regardless of age
- [x] 4.4 Add a test verifying that DB rows are not modified during assembly
