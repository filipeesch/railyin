## Why

Three bugs in the execution engine cause models to misbehave when working in column-scoped contexts. The worktree system message hardcodes all tool descriptions regardless of column config, leading models to loop trying to call unavailable tools. The `on_enter_prompt` is resolved in-memory but never persisted, so its behavioral rules vanish on the next human turn. And `spawn_agent` records `tool_result` but not the preceding `tool_call`, breaking the conversation timeline contract.

## What Changes

- `assembleMessages` worktree context block dynamically lists only the tools available to the current column instead of hardcoding every tool description
- `handleTransition` persists the resolved `on_enter_prompt` content as a `user` message to `conversation_messages` before calling `runExecution`, matching how `handleHumanTurn` already persists user messages
- `spawn_agent` interception in the tool-call loop appends a `tool_call` message before executing children, matching the pattern used by all other tools

## Capabilities

### New Capabilities

_(none)_

### Modified Capabilities

- `workflow-engine`: System message tool descriptions are scoped to the column's configured tools; `on_enter_prompt` resolved content is persisted as a user message before execution
- `spawn-agent`: Engine records a `tool_call` message for `spawn_agent` before child execution, matching the conversation recording contract
- `conversation`: Clarify that tool_call/tool_result pairs must be recorded for ALL tool types including intercepted tools (spawn_agent, ask_me)

## Impact

- `src/bun/workflow/engine.ts`: `assembleMessages` — replace hardcoded tool list with dynamic lookup from column config; `handleTransition` — persist resolved prompt; tool-call loop — add `tool_call` append for `spawn_agent`
- No DB schema changes
- No new dependencies
- No frontend changes
