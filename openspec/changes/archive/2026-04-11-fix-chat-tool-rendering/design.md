## Context

The chat drawer renders a flat list of `ConversationMessage` rows sorted by `id ASC`. Messages are classified into display items: `tool_entry` (collapsed accordion), `code_review`, or `single` (everything else). The `pairToolMessages()` function groups consecutive tool-type messages into `{ call, result, diff }` triples by adjacency.

Two engine paths produce tool messages:
- **engine.ts** (Anthropic/OpenAI direct): executes tools in-process, emits `tool_result` with `metadata.tool_call_id` + a separate `file_diff` message
- **orchestrator.ts** (Copilot SDK): receives tool events from the Copilot CLI, emits `tool_result` with `metadata.parent_tool_call_id` only — no `tool_call_id`, no `file_diff`

The Copilot path already embeds the call ID in the result's content JSON as `tool_use_id`. This field is consistent across both paths and is the correct pairing key.

## Goals / Non-Goals

**Goals:**
- Correct call/result pairing for batched tool responses (multiple calls before multiple results)
- File diff display for all write tools on all engine paths
- Subagent tools nested inside a collapsible spawn_agent entry
- Graceful unknown state for unresolvable tool calls (no infinite spinner)
- Engine-agnostic contract: new engines only need to write `tool_call_id` in metadata and `tool_use_id` in content JSON — no frontend changes needed

**Non-Goals:**
- Not changing the DB schema (metadata column is already a JSON blob)
- Not redesigning the drawer layout or adding real-time streaming indicators per tool
- Not supporting multi-diff per tool_call in the UI (pre-existing single-diff limitation kept)
- Not adding diff support for tools other than write_file, edit_file, patch_file, multi_replace

## Decisions

### 1. Pair by `tool_use_id` in content JSON — not by adjacency, not by metadata

The `tool_use_id` field in `tool_result` content JSON is already written by both engine paths and matches the `id` field in the corresponding `tool_call` content JSON. It's the correct pairing key.

**Rationale**: It's already there, consistent, and engine-agnostic. Any future engine following the existing pattern will work with zero frontend changes.

**Alternative considered**: Pairing by `metadata.tool_call_id` — rejected because the Copilot path doesn't write this field (it would require a backend fix on top of the pairing fix). Reading from content JSON is sufficient.

### 2. `file_diff` linked to tool call by `metadata.tool_call_id` — not by adjacency

`file_diff` messages gain a `tool_call_id` field in their metadata. The frontend looks up diffs by call ID from a `Map<callId, file_diff>` built from the message list — not by checking the next sibling.

**Rationale**: Adjacency breaks for the same reason it breaks for results. ID-based lookup is O(1), correct, and future-proof. Also allows file_diff messages to arrive out-of-order without breaking rendering.

### 3. Copilot path emits `file_diff` via `git diff HEAD -- <path>` after write tool result

When the Copilot engine receives a `tool_result` event for a known write tool (write_file, edit_file, patch_file, multi_replace), it runs `git diff HEAD -- <path>` in the worktree to generate a diff and emits a `file_diff` message with `metadata.tool_call_id`.

**Rationale**: The Copilot path doesn't execute tools locally, so it can't intercept a `WriteResult`. But the worktree state after the tool call is the ground truth — `git diff` is reliable and already used elsewhere in the codebase (see engine.ts line ~2231). The tool name and file path are available from the `tool_call` content JSON.

**Alternative considered**: Carrying diff info in the Copilot tool result event — rejected because it would require changes to the Copilot SDK integration and is outside scope.

### 4. Subagent tools nested by `metadata.parent_tool_call_id`

During `displayItems` computation, tool entries whose call has `metadata.parent_tool_call_id` set are removed from the top-level list and attached as `children[]` on the spawn_agent `ToolEntry` that owns them.

**Rationale**: `parent_tool_call_id` is already written by both engine paths for subagent tool calls. The nesting depth is always 1 (subagents cannot recursively spawn). The collapsible pattern matches Cursor/Copilot UX and eliminates noise.

**ToolEntry type extension:**
```ts
export type ToolEntry = {
  call:     ConversationMessage;
  result:   ConversationMessage | null;
  diff:     ConversationMessage | null;
  children: ToolEntry[];   // ← new
};
```

### 5. Timeout state: 30-second age check on the call's `createdAt`

In `ToolCallGroup.vue`, the `statusIcon` computed checks `now - createdAt > 30_000` when `entry.result` is null. If stale: grey `pi-question-circle`. Otherwise: spinning `pi-spinner`.

**Rationale**: Pure frontend, no backend changes, no new message types. 30 seconds is conservative — tools rarely take this long (run_command is capped at 15s, spawned subagents have their own timeouts). This handles crashed/cancelled executions that left orphaned `tool_call` rows.

### 6. Extract `pairToolMessages` to a pure utility for testability

Move the function to `src/mainview/utils/pairToolMessages.ts` and add `pairToolMessages.test.ts` alongside it. The function is pure (no DOM, no Vue, no IPC) and can be run with `bun test`.

**Rationale**: The current function lives inside a 36KB Vue SFC with no tests. Extracting it enables targeted regression coverage without a full E2E setup.
