## Why

When Claude calls a railyin common tool (e.g. `decision_request`), the Claude SDK delivers it prefixed as `mcp__railyin__decision_request`. The display router checks `COMMON_TOOL_NAMES.has(name)` — which misses because the set holds unprefixed names — so the label falls through to the raw string `mcp__railyin__decision_request` in the UI. The infrastructure to produce clean labels already exists; it just isn't wired for MCP-prefixed names.

## What Changes

- **Claude engine**: Normalize `mcp__railyin__<tool>` names to their bare form before routing through the display builder, so railyin common tools get clean labels (`decision request`, `record decision`, etc.)
- **Claude engine**: Fix `isInternalClaudeToolName` to also recognize `mcp__railyin__report_intent` (and other prefixed internal tools) so they remain hidden from the UI
- **All engines**: Replace raw `name` fallback labels with `humanizeToolName(name)` — strips `mcp__` prefix, replaces `__` with space (server/tool separator), replaces `_` with space — so unknown tools like `mcp__other-server__do_thing` render as `other-server do thing`
- **OpenCode engine**: Wire `display` onto `tool_start` events (currently absent), using `buildCommonToolDisplay` for known tools and `humanizeToolName` as fallback
- **Cleanup**: Deduplicate the identical `stripWorktreePath` helper that exists in both `claude/events.ts` and `copilot/events.ts` by moving it to `tool-display.ts`
- **New helpers**: Add `stripRailyinMcpPrefix`, `humanizeToolName`, and the deduplicated `stripWorktreePath` to `tool-display.ts`

## Capabilities

### New Capabilities
- `mcp-tool-name-normalization`: Rules for normalizing MCP-prefixed tool names to human-readable labels, covering railyin tools, external MCP tools, and the `humanizeToolName` fallback contract

### Modified Capabilities
- `tool-call-display`: The "unknown tool names produce a minimal display" requirement changes — unknown names are now humanized (underscores → spaces, MCP prefix stripped) rather than passed through verbatim

## Impact

- `src/bun/engine/tool-display.ts` — new exports: `stripRailyinMcpPrefix`, `humanizeToolName`, `stripWorktreePath`
- `src/bun/engine/claude/events.ts` — normalization before display routing, `isInternalClaudeToolName` fix, import `stripWorktreePath` from `tool-display.ts`
- `src/bun/engine/copilot/events.ts` — `humanizeToolName` in default case, import `stripWorktreePath` from `tool-display.ts`
- `src/bun/engine/common-tools.ts` — `humanizeToolName` in default case
- `src/bun/engine/opencode/event-translator.ts` — populate `display` on `tool_start` events
- No API changes, no database changes, no frontend changes
