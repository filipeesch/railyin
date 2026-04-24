## Purpose
Defines the semantics for stream event replay on reconnect. When a client reconnects mid-stream or queries persisted stream events, only the latest execution's tail is returned — not the full event history for all past executions. Full conversation history remains available via `conversations.getMessages`.

## Requirements

### Requirement: Stream reconnect replay returns latest execution tail only
The `conversations.getStreamEvents` API SHALL return only the stream events belonging to the **latest execution** for the given conversation (determined by the highest `execution_id` among all rows for that `conversation_id`), ordered by `seq` ascending. Events from prior executions SHALL NOT be returned.

This endpoint is used exclusively for live-tail reconnect — not for full conversation history. Full history is served by `conversations.getMessages`.

#### Scenario: Reconnect after completion returns latest execution events only
- **WHEN** a conversation has events from multiple executions and the client calls `conversations.getStreamEvents`
- **THEN** only events where `execution_id` equals the maximum `execution_id` for that conversation are returned, regardless of `afterSeq`

#### Scenario: afterSeq filters within the latest execution
- **WHEN** the client calls `conversations.getStreamEvents` with `afterSeq: N`
- **THEN** only events from the latest execution where `seq > N` are returned

#### Scenario: Full chat history is unaffected
- **WHEN** the client calls `conversations.getMessages`
- **THEN** all persisted conversation messages across all executions are returned (stream events query has no impact on message history)

#### Scenario: No stream events returns empty array
- **WHEN** the conversation has no stream events (e.g. new conversation, or all events predate the migration)
- **THEN** `conversations.getStreamEvents` returns an empty array without error
