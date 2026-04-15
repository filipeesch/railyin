## 1. Enhance Claude message translator for tool blocks

- [x] 1.1 Add `tool_use` block detection in `translateClaudeMessage()` — when encountering `{ type: "tool_use" }` in assistant message content, extract id, name, and input
- [x] 1.2 Emit `tool_start` event for each tool_use block with callId, name, and JSON-stringified arguments
- [x] 1.3 Store tool metadata in session-level map passed from ClaudeEngine (prepare to accept incoming map parameter)
- [x] 1.4 Add `tool_result` block detection in `translateClaudeMessage()` — when encountering `{ type: "tool_result" }` in user message content, extract tool_use_id and content
- [x] 1.5 Implement tool_result lookup logic — retrieve tool name from session map via tool_use_id, emit `tool_result` event with paired metadata, remove from map
- [x] 1.6 Add graceful fallback — if tool_result references unknown tool_use_id, emit with name="unknown" and log warning

## 2. Add session state tracking to ClaudeEngine

- [x] 2.1 Add `toolMetaByCallId: Map<string, ToolMetadata>` field to ClaudeEngine class
- [x] 2.2 Initialize empty map when executor starts (in `execute()` method before creating session)
- [x] 2.3 Pass map reference to `translateClaudeMessage()` translator calls
- [x] 2.4 Clear map in finally block of execute() to prevent leaks across executions
- [x] 2.5 Define ToolMetadata interface (name, arguments) if not already available

## 3. Surface rate limit and compaction events

- [x] 3.1 Detect `rate_limit_event` in result messages (check `message.subtype === "rate_limit_event"`)
- [x] 3.2 Emit status event: `{ type: "status", message: "Claude API rate limited. Retrying..." }`
- [x] 3.3 Detect `compaction_summary` in system messages (check `system.subtype === "compaction_summary"`)
- [x] 3.4 Emit status event for compaction with user-friendly message (e.g., "Context window compacted using conversation summary")
- [x] 3.5 Verify status messages are relayed to orchestrator and do not interfere with conversation flow

## 4. Add unit and integration tests

- [x] 4.1 Unit test — `translateClaudeMessage()` with tool_use block returns tool_start event with correct callId and metadata
- [x] 4.2 Unit test — `translateClaudeMessage()` with tool_result block paired to preceding tool_use via map
- [x] 4.3 Unit test — `translateClaudeMessage()` with orphaned tool_result (no preceding tool_use) falls back to name="unknown" without crashing
- [x] 4.4 Unit test — rate_limit_event emits status message
- [x] 4.5 Unit test — compaction_summary emits status message
- [x] 4.6 Integration test — conversation_messages table contains both tool_call and tool_result rows after Claude execution with tool invocations

## 5. Validate data pipeline and parity

- [x] 5.1 Verify raw messages captured in model_raw_messages table include tool_use and tool_result blocks
- [x] 5.2 Verify stream_events correctly links tool_start and tool_result events to execution
- [x] 5.3 Verify assistant tool calls are preserved in conversation_messages with type="tool_call"
- [x] 5.4 Smoke test — run a Claude execution that uses tools and confirm UI displays tool calls and results
- [x] 5.5 Compare parity — verify Claude and Copilot tool event handling produces equivalent conversation timelines
