## Why

Every turn of the AI loop assembles a full message history and sends it to the model. Old tool results — file reads, shell output, grep matches from early in the conversation — consume tokens even though they were acted on long ago and are no longer needed. This means the effective context fills faster than necessary, triggering expensive full-conversation compaction calls prematurely. Claude Code addresses this with a "micro-compact" pass that silently clears stale tool results inline, before each API call, without user-visible compaction.

## What Changes

- In `compactMessages()` (the function that assembles the message history for each AI call), apply a recency window to tool result content: tool results older than a configurable number of turns have their content replaced with a short sentinel string (e.g., `[tool result cleared — see compaction summary or re-run if needed]`)
- Only results from "high-churn" tools are cleared (file reads, shell commands, grep, find, patch confirmations — not ask_me responses or user messages)
- The original content remains in the DB; only the assembled payload for the API call is trimmed
- No UI change; the conversation timeline is unaffected

## Capabilities

### New Capabilities

- `micro-compact`: Per-turn inline decay of stale tool result content in the assembled AI context, reducing effective token usage without triggering full compaction

### Modified Capabilities

- `conversation-compaction`: The context token estimation used for auto-compact threshold checking should account for micro-compact decay so the gauge and threshold remain accurate

## Impact

- `src/bun/workflow/engine.ts`: `compactMessages()` function — add inline decay pass over old tool results
- `src/bun/workflow/tools.ts`: possibly export a constant listing which tool names are eligible for decay
- No DB changes, no API changes, no UI changes
- Backward compatible: decay only affects the assembled payload, not stored data
