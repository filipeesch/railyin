## REMOVED Requirements

### Requirement: Stream reconnect replay returns latest execution tail only
**Reason**: A full-repo grep confirmed `conversations.getStreamEvents` has zero callers anywhere in `src/mainview` today — the reconnect-replay mechanism it implements is dead code. The underlying `stream_events` table is dropped entirely as part of this change (see the `conversation` capability), removing the data this endpoint would query. Live streaming continues unaffected via the in-memory WebSocket broadcast, which was never dependent on this replay path.

**Migration**: The `conversations.getStreamEvents` RPC, its handler, and its shared type definitions in `src/shared/rpc-types.ts` are deleted. No client code needs updating since there is no live caller. Any future need for reconnect-tail semantics would be built against the new file-based `ConversationMessageStore` rather than reintroducing `stream_events`.
