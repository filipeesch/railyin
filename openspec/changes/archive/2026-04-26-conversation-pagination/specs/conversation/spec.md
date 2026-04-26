## MODIFIED Requirements

### Requirement: Conversation messages are accessible via paginated API
The system SHALL expose `conversations.getMessages` as a paginated endpoint. The response SHALL be a wrapped object `{ messages: ConversationMessage[], hasMore: boolean }` rather than a flat array. The endpoint SHALL accept optional `beforeMessageId` and `limit` parameters for cursor-based traversal. When called without `beforeMessageId`, it SHALL return the newest `limit` messages. `hasMore` SHALL be `true` when older messages exist beyond the returned page.

#### Scenario: Response is always a wrapped object
- **WHEN** `conversations.getMessages` is called with any parameters
- **THEN** the response is `{ messages: ConversationMessage[], hasMore: boolean }` — never a bare array

#### Scenario: Default call returns newest messages
- **WHEN** `conversations.getMessages` is called with only `conversationId`
- **THEN** the response contains the newest 50 messages in ascending ID order

#### Scenario: Cursor parameter narrows result to older messages
- **WHEN** `conversations.getMessages` is called with `beforeMessageId`
- **THEN** only messages with `id < beforeMessageId` are returned

#### Scenario: Messages within a page are returned in ascending ID order
- **WHEN** a paginated response is returned
- **THEN** `messages` are ordered from oldest to newest (ascending `id`)
