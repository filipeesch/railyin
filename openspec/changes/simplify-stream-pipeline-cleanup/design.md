## Context

The `conversationId`-first migration shipped successfully. All stream events now carry `conversation_id` as the primary routing key. However, several legacy structures remain:

1. **Dual broadcast path**: The backend fires both `stream.token` (legacy, raw token strings) and `stream.event` (structured block events) for every AI token. The frontend has a `LegacyStreamState` fallback that only activates when `streamState` is null — which never happens in normal operation because `stream.event` always fires alongside `stream.token`.
2. **`stream_events.task_id`**: The column is populated on every insert and has a dedicated index, but no production query reads it. The only query API is `getStreamEventsByConversation()`.
3. **`stream_events.conversation_id` nullable**: All new writes supply a non-null `conversation_id` post-migration. Pre-backfill rows exist in older installs but are now considered legacy data that can be discarded.
4. **Replay returns all executions**: `getStreamEventsByConversation()` returns every execution's events for a conversation. The frontend resets its block tree on `executionId` change, so replaying old executions on reconnect does wasted work and can cause transient ghost blocks.

## Goals / Non-Goals

**Goals:**
- Remove the `stream.token` broadcast path and all frontend legacy streaming state
- Drop `stream_events.task_id` via a safe SQLite table-recreation migration
- Tighten `stream_events.conversation_id` to NOT NULL in the same migration
- Narrow replay semantics to latest execution tail only
- Add a Playwright test verifying clean reconnect behavior

**Non-Goals:**
- Changes to `conversations.getMessages` or full chat history rendering
- Any changes to task-owned concepts (todos, worktrees, board state)
- Pagination of stream events
- Removing `taskId` from `StreamEvent` (still used for task association in other parts of the system)

## Decisions

### Decision 1: Remove `stream.token` entirely rather than deprecate gracefully

**Choice**: Delete the broadcast, the `StreamToken` type, and all frontend handling in a single pass.

**Rationale**: The legacy path is provably unreachable — `stream.event` always fires before any `stream.token` could render (both are emitted from the same `onToken()` call, and the frontend guard only activates the legacy path when `streamState` is null). There are no clients that receive `stream.token` without also receiving `stream.event`. Staged deprecation would add churn without risk mitigation.

**Alternative considered**: Keep `stream.token` as a documented fallback for older clients. Rejected because there are no versioned clients — this is a single-server, single-client architecture and both sides deploy together.

### Decision 2: SQLite table recreation for `task_id` removal + NOT NULL constraint

**Choice**: Use SQLite's `CREATE TABLE ... INSERT SELECT ... DROP ... RENAME` pattern in a single migration.

**Rationale**: SQLite does not support `DROP COLUMN` (prior to 3.35) or `ALTER COLUMN`. Table recreation is the standard, well-tested approach in this codebase (used in migration `031` already). Doing both changes — dropping `task_id` and adding NOT NULL — in one migration minimises schema churn.

**Data loss accepted**: Rows where `conversation_id IS NULL` are dropped during the `INSERT OR IGNORE ... SELECT ... WHERE conversation_id IS NOT NULL` step. These rows predate the backfill migration and have no corresponding persisted messages — dropping them has no product impact.

**Alternative considered**: Keep `task_id` nullable with a documented comment. Rejected per user decision — the column has no remaining query value and its index wastes write overhead.

### Decision 3: Replay returns latest execution tail only

**Choice**: `getStreamEventsByConversation()` is changed to filter by `MAX(execution_id)` for the given conversation.

**Rationale**: The frontend already resets its block tree when `executionId` changes (see `onStreamEvent` in `conversation.ts`). Replaying all prior executions on reconnect causes the block tree to be built and discarded multiple times before settling on the latest execution — wasted render cycles and potential ghost blocks during a brief flash. Returning only the latest execution's tail is the correct reconnect semantic.

**Full conversation history is unaffected**: `conversations.getMessages` reads `conversation_messages` (persisted rows) and is not changed. Users always see full history; only the live-tail reconnect query is narrowed.

**Alternative considered**: Add an optional `executionId` parameter. Rejected — callers always want the latest execution on reconnect; adding optionality invites misuse.

## Risks / Trade-offs

- **Risk**: A future execution engine that does NOT emit `stream.event` would leave users with no live feedback.
  → **Mitigation**: All current engine paths call `setOnStreamEvent()`. Document this as a hard requirement for any new engine adapter.

- **Risk**: The table recreation migration is slow on DBs with millions of stream event rows.
  → **Mitigation**: The migration runs at startup before any requests are served. For typical installs, stream_events rows number in the hundreds of thousands, not millions. Acceptable startup delay.

- **Risk**: Dropping `conversation_id IS NULL` rows could confuse a user who inspects their DB directly.
  → **Mitigation**: Migration log message clearly states rows are dropped. No product UI depends on those rows.

## Migration Plan

**Single migration** (`id: "035_stream_events_cleanup"` or next sequential):

1. Check `hasTable("stream_events")`
2. Create `stream_events_new` with schema: `(id, conversation_id NOT NULL, execution_id, seq, block_id, type, content, metadata, parent_block_id, subagent_id, created_at)` and `UNIQUE(conversation_id, seq)`
3. `INSERT OR IGNORE INTO stream_events_new SELECT id, conversation_id, execution_id, seq, block_id, type, content, metadata, parent_block_id, subagent_id, created_at FROM stream_events WHERE conversation_id IS NOT NULL`
4. `DROP TABLE stream_events`
5. `ALTER TABLE stream_events_new RENAME TO stream_events`
6. Recreate indexes: `idx_stream_events_conversation(conversation_id, seq)`, `idx_stream_events_execution(execution_id, seq)` — `idx_stream_events_task` is NOT recreated

**Rollback**: Not applicable — this is a destructive schema change. Users on older versions who downgrade will hit a schema mismatch; standard advice is to restore from backup.

## Open Questions

None — all decisions resolved during exploration session.
