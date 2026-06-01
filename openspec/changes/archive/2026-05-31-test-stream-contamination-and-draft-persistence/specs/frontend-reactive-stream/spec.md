## MODIFIED Requirements

### Requirement: Per-conversation lifecycle

The test assertions for non-active conversation `done` events must reflect the post-fix behavior: the `streamStates` entry is **deleted**, not retained as a cleared shell.

#### Scenario: SB-5 — done for non-active conversation removes the entry
- **WHEN** a `done` stream event arrives for a conversation that is not currently active
- **THEN** `streamStates.get(conversationId)` returns `undefined`

#### Scenario: SB-9 — non-active conversation entry is not accessible after done
- **WHEN** a `done` stream event arrives for a non-active conversation
- **THEN** `streamStates.get(conversationId)` returns `undefined`
- **AND** no cleared shell entry exists in the Map

#### Scenario: SS-3 — queue drain for background task does not contaminate active view (E2E)
- **WHEN** a background task completes (triggering queue drain) while the user is viewing a different task
- **THEN** the active task's conversation view shows no new messages
- **AND** no streaming content from the background task is visible in the active view
