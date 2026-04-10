## Context

The execution engine has three bugs that compound when a model works in a column-scoped context (e.g., the `explore` column with `tools: [read, search, web, interactions, agents]`):

1. **Worktree context hardcodes all tool descriptions** — `assembleMessages` (engine.ts ~318-360) emits a system message listing every tool (read, write, search, web, shell, interaction, agent) regardless of the column's `tools` config. The model sees write tool descriptions in natural language but can't find them in the function definitions, so it loops calling `read_file` while saying "now I'll make the edits."

2. **`on_enter_prompt` is ephemeral** — `handleTransition` passes `column.on_enter_prompt` to `runExecution`, which resolves it via `resolveSlashReference` and feeds it as an in-memory user message to the AI. It is never written to `conversation_messages`. On the next human turn, the entire prompt (with behavioral rules like "NEVER write code") is gone. The only surviving constraint is `stage_instructions`, which is typically too brief. Contrast with `handleHumanTurn`, which persists the user message via `appendMessage` before calling `runExecution`.

3. **`spawn_agent` missing `tool_call` record** — The spawn_agent intercept (engine.ts ~1378-1425) runs children and appends a `tool_result` message, but never appends a `tool_call` message. All other tools in the loop append both `tool_call` and `tool_result`. This breaks conversation timeline completeness and could cause issues during compaction or replay.

## Goals / Non-Goals

**Goals:**

- Worktree context tool descriptions match the column's configured tools — no phantom tools
- `on_enter_prompt` content survives in conversation history across human turns
- `spawn_agent` records both `tool_call` and `tool_result` like all other tools

**Non-Goals:**

- API rate limiting / concurrency control (separate change)
- Strengthening `stage_instructions` content for specific columns (workflow YAML concern, not engine)
- Changing how `resolveSlashReference` works

## Decisions

### D1: Dynamic tool descriptions in worktree context

**Choice**: Pass the column's resolved tool names into `assembleMessages` and generate the tool description block dynamically based on which tool groups are active.

**Rationale**: The worktree context system message currently hardcodes ~30 lines of tool descriptions. `resolveToolsForColumn` already resolves tool groups to function definitions for the API call — use the same source of truth to build the natural-language descriptions. A simple lookup table maps each tool name to its one-line description.

**Alternative considered**: Remove the tool description block entirely (models get function definitions via the API). Rejected because natural-language guidance like "Always read before you write. Use patch_file for targeted edits" is valuable context that function schemas alone don't convey.

### D2: Persist resolved `on_enter_prompt` as a user message

**Choice**: In `handleTransition`, after resolving the slash reference, call `appendMessage(taskId, conversationId, "user", "prompt", resolvedContent)` to persist the resolved prompt content to `conversation_messages` before passing it to `runExecution`.

The `sender` field is `"prompt"` (not `"user"`) to distinguish workflow-initiated prompts from human messages. This is consistent with how the system already uses `sender` to differentiate message origins.

Since the message is now in DB history, `assembleMessages` will pick it up via the conversation history query. The `newMessage` parameter to `runExecution` can remain the raw slug — but `assembleMessages` needs to handle the case where the prompt is already in history (to avoid duplication). The existing dedup logic at lines ~398-410 (which checks if `newMessage` already matches the last user message) already handles this.

**Rationale**: Matches `handleHumanTurn`'s pattern exactly. The prompt becomes part of the persistent conversation timeline. Compaction preserves its intent. Follow-up human turns see the original behavioral contract.

**Alternative considered**: Re-resolve `on_enter_prompt` on every execution (inject via `stage_instructions`). Rejected because it forces every human turn to re-read and re-resolve the slash file, the prompt can be arbitrarily long (bad for `stage_instructions` which is a system message), and it doesn't match the mental model of "the prompt was sent once."

### D3: Record `tool_call` for `spawn_agent`

**Choice**: Before executing children, append a `tool_call` message with the spawn_agent call details (matching the pattern at line ~1432 for regular tools). Also push the `tool_call` entry to `liveMessages` for the current streaming round.

**Rationale**: Trivial fix. The code is identical to what happens for every other tool — it was simply missed when the spawn_agent intercept was written.

## Risks / Trade-offs

- **[D2] Large prompts in history**: Resolved `on_enter_prompt` content (e.g., `/opsx-explore` resolves to ~1KB) is now permanently in the conversation. This is intentional — compaction preserves its intent — but uses slightly more context window. → Mitigated: prompts are typically 500-2000 tokens, well within budget. Compaction already summarizes old messages.

- **[D1] Tool description drift**: The lookup table mapping tool names to descriptions must be kept in sync with actual tool definitions. → Mitigated: both live in `tools.ts`; the lookup table is defined once next to `TOOL_GROUPS`.
