## Why

Claude engine currently drops tool calls (tool_use blocks) and tool results from the message stream, causing a critical parity gap with Copilot engine. Users cannot see what tools the agent invoked or where tool results went, making the agent's reasoning opaque. Raw message capture (model_raw_messages table) reveals the lost events: task 94 execution 662 had 24 raw Claude SDK events but only 5 messages surfaced to UI (missing 7 tool_use, 7 tool_result, 1 rate_limit). This is a data integrity and user experience issue.

## What Changes

- Implement Claude translator to emit `tool_start` events when detecting `tool_use` blocks in assistant messages
- Implement Claude translator to pair `tool_result` blocks from user messages back to their preceding `tool_use` parents using orchestrator state tracking (matching Copilot's approach)
- Surface rate limit events as `status` messages to give users visibility into API throttling
- Surface compaction_summary messages in UI timeline for transparency into context window management
- Add tests validating tool call/result pairing and rate limit surfacing

## Capabilities

### New Capabilities

### Modified Capabilities
- `claude-engine`: Add tool_use block translation to tool_start events; pair tool_result blocks with preceding tool_use calls via orchestrator tracking
- `execution-engine`: Ensure tool_start and tool_result events flow correctly through orchestrator (no spec change, validation only)
- `conversation`: Verify tool_call and tool_result message types are created in conversation_messages table (no spec change, validation only)

## Impact

- **Files Changed**: 
  - `src/bun/engine/claude/events.ts` — add tool_use/tool_result translation logic
  - `src/bun/engine/orchestrator.ts` — add tool call tracking state (like Copilot's toolMetaByCallId)
  - `src/bun/engine/types.ts` (likely no change, but review if EngineEvent needs updates)
  - Tests: add or update test cases for tool pairing

- **User-Facing**: Tool calls and results now visible in conversation timeline, matching Copilot behavior
- **Data Model**: No schema changes (tool_call and tool_result already supported in conversation_messages)
- **Dependencies**: None (uses existing EngineEvent types and orchestrator infrastructure)
