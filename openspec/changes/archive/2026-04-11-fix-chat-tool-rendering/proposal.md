## Why

The chat drawer renders tool calls in a broken timeline. Three compounding bugs cause this:

1. **Mis-pairing**: `pairToolMessages()` pairs by adjacency (`call → result → diff`), but real batched LLM responses arrive as multiple consecutive `tool_call` rows followed by multiple `tool_result` rows. This mismatches calls to results, drops most results, and leaves calls spinning forever.

2. **No file diff on Copilot path**: The Copilot engine path (orchestrator.ts) never emits `file_diff` messages. `edit_file`/`write_file` tool calls show no diff UI even when files were changed.

3. **Subagent noise**: Tools called by `spawn_agent` subagents appear flat in the timeline alongside top-level tools, creating visual clutter with no user value.

The combined effect is a conversation view that shows messages out of logical order, tool call results attached to wrong calls, missing file diffs, and unresolvable spinner states — a timeline that cannot be trusted.

## What Changes

- Replace adjacency-based `pairToolMessages()` with ID-based pairing using `tool_use_id` (already present in all tool_result content JSON across all engine paths)
- Define an engine-agnostic contract: `tool_result` metadata always carries `tool_call_id`; `file_diff` metadata always carries `tool_call_id` — both engines write these fields
- Emit `file_diff` from the Copilot engine path (orchestrator.ts) using a post-execution `git diff HEAD -- <path>` for write tools
- Nest subagent tool calls inside a collapsible `spawn_agent` entry (using `metadata.parent_tool_call_id`) instead of showing them flat in the timeline
- Show an "unknown" state (grey icon) for `tool_call` messages older than 30 seconds with no matching result, instead of spinning forever
- Extract `pairToolMessages` to a pure utility and add unit tests covering batched, subagent, and orphan cases

## Capabilities

### Modified Capabilities
- `chat-tool-rendering`: Tool calls are now paired by ID, rendered in correct timeline order, with subagent tools nested inside their spawn_agent collapsible
- `chat-file-diff`: File diffs are shown for write tools on all engine paths (Copilot + direct), linked to their tool call by ID

### New Capabilities
- `tool-call-timeout`: Tool calls with no result after 30 seconds display a grey unknown state instead of an infinite spinner

## Impact

- Frontend: `TaskDetailDrawer.vue` (pairing logic, subagent grouping, timeout state), `ToolCallGroup.vue` (subagent collapsible body, timeout icon)
- Backend: `src/bun/engine/orchestrator.ts` (add `tool_call_id` to result metadata, emit `file_diff` via git diff)
- New file: `src/mainview/utils/pairToolMessages.ts` (extracted pure function, unit-tested)
- New tests: `src/mainview/utils/pairToolMessages.test.ts`
- No DB schema changes — uses existing `metadata` JSON column on `conversation_messages`
