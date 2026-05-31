## MODIFIED Requirements

### Requirement: Per-conversation lifecycle
Each entry in `streamStates` MUST be fully removed (deleted from the Map) when the conversation's execution completes AND the conversation is not currently active. Retaining a cleared-but-present Map entry is not permitted — the entry MUST be deleted.

When a conversation becomes active, its stream state is loaded from the server via `loadMessages`. There is no in-memory state to recover from a deleted entry.

#### Scenario: Completed non-active stream state is deleted
- **WHEN** a `done` stream event arrives for a conversation that is not currently the active conversation
- **THEN** the `streamStates` Map entry for that conversation ID is fully deleted (not merely cleared)

#### Scenario: Completed active stream state triggers reload
- **WHEN** a `done` stream event arrives for the currently active conversation
- **THEN** `loadMessages` is called to refresh conversation content from the server, and the `streamStates` entry is retained with `isDone: true` until the next `selectTask`/`selectSession`
