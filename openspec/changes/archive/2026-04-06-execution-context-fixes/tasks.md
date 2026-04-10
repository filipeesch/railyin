## 1. Dynamic tool descriptions in worktree context (D1)

- [x] 1.1 Add a `TOOL_DESCRIPTIONS` lookup table in `tools.ts` mapping each tool name to its one-line natural-language description
- [x] 1.2 Export a helper `getToolDescriptionBlock(toolNames: string[]): string` that builds the grouped description lines from the lookup table
- [x] 1.3 Update `assembleMessages` in `engine.ts` to accept the resolved tool names and call `getToolDescriptionBlock` instead of the hardcoded block (lines ~318-360)

## 2. Persist resolved on_enter_prompt (D2)

- [x] 2.1 In `handleTransition`, resolve the `on_enter_prompt` slash reference before calling `runExecution`, and persist the resolved content via `appendMessage(taskId, conversationId, "user", "prompt", resolvedContent)`
- [x] 2.2 Adjust the `runExecution` call in `handleTransition` so it passes the already-resolved content (not the raw slug), avoiding double resolution
- [x] 2.3 Verify `assembleMessages` dedup logic correctly handles the prompt already being in DB history (no duplicate user message)

## 3. Record tool_call for spawn_agent (D3)

- [x] 3.1 In the spawn_agent intercept block, append a `tool_call` message to `conversation_messages` before executing children (matching the pattern used for regular tools)
- [x] 3.2 Push the corresponding assistant message with `tool_calls` to `liveMessages` before child execution

## 4. Verification

- [x] 4.1 Type-check passes (`bun run check`)
- [x] 4.2 Existing unit tests pass (`bun test`)
