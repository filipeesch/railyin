## Why

The chat console rollout completed the foundational schema migration to nullable conversation ownership, chat sessions, and execution-level conversation routing. What remains is a cleanup pass: conversation-scoped reads, stream replay, and timeline rendering still carry task-shaped compatibility paths that hide real correctness gaps and keep `conversationId` from being the true canonical key.

The most visible consequence is that active task and session timelines can diverge from the real chronological order because persisted messages and live stream blocks are rendered as separate sections. At the same time, persisted stream events are not yet fully keyed by `conversation_id`, which weakens replay and reconnect behavior for standalone chat sessions.

## What Changes

- Remove deprecated task-based aliases from conversation-scoped read APIs where callers already have `conversationId`.
- Make stream-event persistence and replay reliably conversation-scoped, including recovery/backfill of historical rows where possible.
- Update execution and row typing so conversation-owned data no longer assumes a non-null task identity.
- Unify task and session conversation rendering around a single merged timeline, with persisted conversation history followed by a live execution tail while a run is active.
- Preserve room for future long-chat pagination by keeping durable history in `conversation_messages` and treating structured stream events as active-execution and replay state rather than the sole historical source.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `conversation`: conversation-scoped reads, stream-event persistence/replay, and compatibility requirements are updated so `conversationId` is the canonical routing key and timeline behavior remains coherent across task and standalone session conversations.
- `task-detail`: task chat rendering is updated to show a single coherent conversation timeline instead of separate persisted-message and live-stream sections.
- `session-chat-parity`: standalone sessions continue to reuse the shared chat surface, including the same merged conversation timeline model used by task chat.

## Impact

- Backend conversation handlers, stream-event persistence, execution writes, DB migrations, and row typing.
- Shared RPC types and frontend conversation/task/session stores.
- Task detail and session chat rendering paths, especially live stream ordering and replay/reconnect behavior.
- Backend and UI test coverage around conversation reads, stream replay, and chronology-sensitive chat rendering.
