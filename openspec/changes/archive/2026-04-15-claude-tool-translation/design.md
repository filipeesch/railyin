## Context

Claude engine's `translateClaudeMessage()` currently processes three message types (assistant, result, system) but lacks handlers for:
- `assistant.message.content[tool_use]` — the agent declaring intent to call a tool
- `user.message.content[tool_result]` — the agent receiving tool execution results

These blocks are captured in the raw `model_raw_messages` table (proving the data exists), but the translator returns empty arrays for unhandled block types, causing the messages to disappear before reaching the UI.

Copilot engine already solves this via `translateCopilotStream()`:
- `tool.execution_start` event triggers `tool_start` EngineEvent emission
- Metadata stored in `toolMetaByCallId` map
- `tool.execution_complete` event paired via callId to emit `tool_result`

Claude architecture differs: tool calls and results arrive in *separate* messagees (assistant message with tool_use, then user message with tool_result), not as streamed events in one session. However, they arrive sequentially within a session, allowing the same tracking approach.

## Goals / Non-Goals

**Goals:**
- Detect `tool_use` blocks in Claude assistant messages and emit `tool_start` events (matching Copilot behavior)
- Pair `tool_result` blocks from user messages with preceding `tool_use` calls via a per-session call ID map
- Emit `tool_result` events with paired tool name and metadata
- Surface `rate_limit_event` as status messages
- Surface `compaction_summary` messages in conversation UI
- Maintain parity with Copilot engine's tool call handling
- Preserve all metadata needed by orchestrator (callId, tool name, arguments, parentCallId, isInternal flags)

**Non-Goals:**
- Change the raw message capture (model_raw_messages table is working correctly)
- Refactor orchestrator event handling (use existing patterns)
- Add new conversation message types (tool_call and tool_result already exist)
- Handle tool streaming or partial results (Claude doesn't stream tool execution)

## Decisions

### D1: Tool call tracking location — per-session state in ClaudeEngine
**Decision**: Track pending tool calls in a `Map<callId, ToolMetadata>` within the ClaudeEngine instance. When a session is created, initialize an empty map. When translateClaudeMessage encounters a tool_use block, store metadata. When it encounters a tool_result block, look up the metadata, emit the paired event, then remove from map.

**Rationale**: 
- Mirrors Copilot's `toolMetaByCallId` approach (familiar pattern)
- Tool calls and results arrive sequentially in the same Claude session, so session-level tracking is safe
- Avoids polluting orchestrator with translator-specific state
- Automatic cleanup when session ends

**Alternative considered**: Store in orchestrator (more heavyweight, requires passing back to translator, complicates code flow)

### D2: Handling tool_use blocks — extract metadata and emit tool_start
**Decision**: When detecting `assistant.message.content[{type: "tool_use"}]`:
1. Extract id, name, input (arguments)
2. Store in session map: `toolMetaByCallId.set(id, { name, arguments: input })`
3. Emit `tool_start` EngineEvent: `{ type: "tool_start", callId: id, name, arguments: JSON.stringify(input) }`
4. Infer `isInternal` flag based on tool name patterns (same as Copilot: starts with "internal_" or "copilot_", or is "report_intent")

**Rationale**: 
- Preserves all metadata needed for UI rendering (tool name, arguments)
- Matches Copilot structure exactly
- callId enables pairing with tool_result

**Alternative considered**: Emit tool_start only on tool_result (wait for completion) — loses visibility into pending calls

### D3: Handling tool_result blocks — pair with preceding tool_use via map
**Decision**: When detecting `user.message.content[{type: "tool_result"}]`:
1. Extract tool_use_id and content
2. Look up in `toolMetaByCallId.get(tool_use_id)`
3. If found: emit `tool_result` with paired metadata (name, arguments, etc.)
4. Delete from map: `toolMetaByCallId.delete(tool_use_id)`
5. If not found: emit with name="unknown" (graceful fallback; log warning)

**Rationale**: 
- Ensures tool_result always emits, even if preceding tool_use was missed in raw stream
- Matches Copilot's pairing strategy
- Automatic cleanup prevents memory leaks across executions

**Alternative considered**: Require tool_use to always precede tool_result (stricter but fragile if edge case emerges)

### D4: Rate limit event surfacing — emit as status message
**Decision**: When Claude SDK emits `rate_limit_event` in a result message:
```typescript
if (message.type === "result" && message.subtype === "rate_limit") {
  return [{ type: "status", message: "Claude API rate limited. Retrying..." }];
}
```

**Rationale**: 
- Educates users about API constraints
- Shows system is responsive (not silently paused)
- Matches existing status event infrastructure (already used for other system messages)
- Non-blocking; doesn't stop execution

**Alternative considered**: Ignore silently (less transparent) or emit as error (wrong severity)

### D5: Compaction summary surfacing — emit as status message
**Decision**: When detecting `system.message` with `subtype === "compaction_summary"`:
```typescript
if (system.subtype === "compaction_summary" && system.summary) {
  return [{ type: "status", message: `Context window compacted: ${system.summary}` }];
}
```

**Rationale**: 
- Already handled in the "system message" case, just needs refinement
- Surfacing summary gives users visibility into context management
- Helps understand why conversation length resets

**Alternative considered**: Keep compaction internal-only (loses transparency)

## Risks / Trade-offs

**[Risk]** Tool call pairing relies on callId matching. If Anthropic changes the callId format or behavior, pairing breaks.
→ **Mitigation**: Raw messages are captured; forensic analysis via model_raw_messages table can detect this. Add tests asserting callId format.

**[Risk]** If a tool_use is lost in raw capture, we can't pair the tool_result to the right name.
→ **Mitigation**: Emit with name="unknown" instead of failing; log warning. User sees "tool result: unknown" instead of nothing.

**[Risk]** Map cleanup only happens when tool_result is detected. If a tool_use never gets a result (e.g., agent crashes mid-execution), the map entry persists.
→ **Mitigation**: Add session cleanup in ClaudeEngine.execute() finally block to clear map on execution end. Maps are small and session-scoped anyway.

**[Risk]** Rate limit and compaction messages might be noisy if they occur frequently.
→ **Mitigation**: Already acceptable for other status messages; UI can filter if needed.

## Migration Plan

No database schema or breaking API changes. Deployment is a code drop:

1. Update `src/bun/engine/claude/events.ts` with enhanced translator
2. Update `src/bun/engine/claude/engine.ts` to manage session map
3. Add tests to `refinement/` or new test file validating tool pairing
4. Deploy with standard flow (no migrations needed)
5. Monitor raw_messages table to validate new tool_call/tool_result events are captured

Rollback: Revert code; no cleanup needed (schema unchanged).
