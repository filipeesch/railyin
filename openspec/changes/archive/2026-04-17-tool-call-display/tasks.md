## 1. Type contract

- [x] 1.1 Add `ToolCallDisplay` interface to `src/bun/engine/types.ts` (`label`, `subject?`, `contentType?`, `startLine?`)
- [x] 1.2 Add optional `display?: ToolCallDisplay` field to the `tool_start` variant in the `EngineEvent` union

## 2. Common tools display builder

- [x] 2.1 Add `buildCommonToolDisplay(name: string, args: Record<string, unknown>): ToolCallDisplay` to `src/bun/engine/common-tools.ts`, covering all 9 entries in `COMMON_TOOL_DEFINITIONS` plus `interview_me`

## 3. Claude engine — display attachment

- [x] 3.1 Add `buildClaudeBuiltinDisplay(name: string, input: Record<string, unknown>): ToolCallDisplay` to `src/bun/engine/claude/events.ts`, covering all observed Claude Code native tools (`Bash`/`bash`, `Read`/`read`, `Write`/`write`, `Edit`/`edit`/`MultiEdit`, `Glob`/`glob`, `Grep`/`grep`/`rg`, `LS`/`view`, `WebFetch`/`web_fetch`, `Task`/`task`, `TodoWrite`, `apply_patch`, `create`, `skill`, `store_memory`, and unknown fallback)
- [x] 3.2 In `translateClaudeMessage()`, call `buildCommonToolDisplay` when `block.name` is in `COMMON_TOOL_NAMES`, otherwise call `buildClaudeBuiltinDisplay`; attach result as `display` on the emitted `tool_start` event

## 4. Claude engine — dead code removal

- [x] 4.1 Remove the `emit` parameter from `buildClaudeToolServer` in `src/bun/engine/claude/tools.ts`
- [x] 4.2 Remove the `emit({ type: "tool_start" })` and `emit({ type: "tool_result" })` calls inside the MCP handler callbacks in `claude/tools.ts`
- [x] 4.3 Remove the `EngineEvent` import from `claude/tools.ts` (no longer needed)

## 5. Copilot engine — display attachment

- [x] 5.1 Add `buildCopilotNativeDisplay(name: string, args: Record<string, unknown>): ToolCallDisplay` to `src/bun/engine/copilot/events.ts`, covering `read_file`, `create`, `edit`, `apply_patch`, `run_in_terminal`, `grep_search`, `find_files`/`find`, `write_file`, `delete_file`, `rename_file`, and unknown fallback
- [x] 5.2 In `translateEvent()` for `tool.execution_start`, call `buildCommonToolDisplay` when `data.toolName` is in `COMMON_TOOL_NAMES`, otherwise call `buildCopilotNativeDisplay`; attach as `display` on the returned `tool_start` event
- [x] 5.3 Remove the two duplicate `import type { Tool }` and `import type { CommonToolContext }` lines from `src/bun/engine/copilot/tools.ts`

## 6. Orchestrator pass-through

- [x] 6.1 In `orchestrator.ts` `consumeStream()` `tool_start` case, include `display: event.display` in the `toolCallMsg` JSON object that is serialized and stored in `conversation_messages`

## 7. UI — consume display metadata

- [x] 7.1 In `ToolCallGroup.vue` `parsedCall` computed, extract `display` from the parsed JSON and expose it alongside `name` and `args`
- [x] 7.2 Replace `primaryArg` computed (the `args.path ?? args.from_path ?? ...` chain) with `display?.subject ?? ""`
- [x] 7.3 Replace `readFileStartLine` computed (the `args.startLine ?? args.start_line` chain) with `display?.startLine`
- [x] 7.4 Replace both `toolName === 'read_file'` checks (CSS class and `v-else-if`) with `parsedCall.value.display?.contentType === 'file'`
- [x] 7.5 Replace `toolName` display in the header badge with `display?.label ?? toolName` so the human-readable verb is shown when available
