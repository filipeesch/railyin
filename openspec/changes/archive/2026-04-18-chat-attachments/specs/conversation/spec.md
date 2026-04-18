## ADDED Requirements

### Requirement: User message supports multipart content with image attachments
The system SHALL accept an optional `attachments` array alongside `content` in the `tasks.sendMessage` RPC. When present, the attachments SHALL be threaded through the engine to produce a multipart user message for the current AI turn only. Attachments SHALL NOT be replayed from the database in subsequent turns.

#### Scenario: sendMessage with attachments accepted
- **WHEN** a client calls `tasks.sendMessage` with `{ taskId, content: "text", attachments: [{ label, mediaType, data }] }`
- **THEN** the call succeeds and the message is persisted with text content and attachment metadata

#### Scenario: Attachments not replayed in subsequent turns
- **WHEN** the conversation history is assembled for a subsequent AI turn
- **THEN** the previous user message is included as plain text only; no image blocks are injected for it
