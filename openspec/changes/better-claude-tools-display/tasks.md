## 1. Shared display utilities (`tool-display.ts`)

- [x] 1.1 Add `stripRailyinMcpPrefix(name: string): string` — strips `mcp__railyin__` prefix, returns name unchanged for all other inputs
- [x] 1.2 Add `humanizeToolName(name: string): string` — strips `mcp__` prefix, replaces `__` with space, replaces `_` with space
- [x] 1.3 Move `stripWorktreePath` from `claude/events.ts` into `tool-display.ts` and export it

## 2. Claude engine (`claude/events.ts`)

- [x] 2.1 Import `stripRailyinMcpPrefix` and `humanizeToolName` and `stripWorktreePath` from `tool-display.ts`
- [x] 2.2 Remove the local `stripWorktreePath` definition
- [x] 2.3 In `translateClaudeMessage`, normalize `block.name` via `stripRailyinMcpPrefix` before the `COMMON_TOOL_NAMES.has()` check and before calling display builders
- [x] 2.4 In `isInternalClaudeToolName`, apply `stripRailyinMcpPrefix` before the existing `startsWith` and equality checks
- [x] 2.5 Replace `default: return { label: name }` in `buildClaudeBuiltinDisplay` with `default: return { label: humanizeToolName(name) }`

## 3. Copilot engine (`copilot/events.ts`)

- [x] 3.1 Import `stripWorktreePath` and `humanizeToolName` from `tool-display.ts`
- [x] 3.2 Remove the local `stripWorktreePath` definition
- [x] 3.3 Replace `default: return { label: name }` in `buildCopilotNativeDisplay` with `default: return { label: humanizeToolName(name) }`

## 4. Common tools (`common-tools.ts`)

- [x] 4.1 Import `humanizeToolName` from `tool-display.ts`
- [x] 4.2 Replace `default: return { label: name }` in `buildCommonToolDisplay` with `default: return { label: humanizeToolName(name) }`

## 5. OpenCode engine (`opencode/event-translator.ts`)

- [x] 5.1 Import `COMMON_TOOL_NAMES` and `buildCommonToolDisplay` from `common-tools.ts` and `humanizeToolName` from `tool-display.ts`
- [x] 5.2 In the `"running"` branch of `translateToolPart`, compute and attach `display` using `buildCommonToolDisplay` for known tools and `{ label: humanizeToolName(part.tool) }` for unknown tools
