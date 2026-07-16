## MODIFIED Requirements

### Requirement: Conversation history is loaded with cursor-based pagination
The system SHALL support paginated access to conversation messages via a `beforeMessageId` cursor. The initial load SHALL return the newest `limit` messages. Subsequent requests with `beforeMessageId` SHALL return messages strictly older than that ID. The response SHALL include a `hasMore` flag indicating whether additional older messages exist beyond the returned page. This pagination contract SHALL behave identically whether the conversation's messages are served from a file-backed `ConversationMessageStore` or the legacy `conversation_messages` SQLite table — the `conversations.getMessages` handler SHALL NOT branch on storage medium itself; it delegates entirely to the resolved store.

#### Scenario: Initial load returns newest page
- **WHEN** `conversations.getMessages` is called with `conversationId` only (no `beforeMessageId`)
- **THEN** the response contains the newest 50 messages in ascending ID order and `hasMore: true` when the conversation has more than 50 messages

#### Scenario: Initial load on short conversation
- **WHEN** `conversations.getMessages` is called for a conversation with 50 or fewer messages
- **THEN** all messages are returned and `hasMore: false`

#### Scenario: Cursor page returns correct older slice
- **WHEN** `conversations.getMessages` is called with `beforeMessageId = N`
- **THEN** the response contains only messages with `id < N`, up to `limit`, in ascending ID order

#### Scenario: Cursor at the beginning of history
- **WHEN** `conversations.getMessages` is called with `beforeMessageId` equal to or less than the oldest message's ID
- **THEN** the response contains `messages: []` and `hasMore: false`

#### Scenario: Full cursor traversal covers all messages with no duplicates and no gaps
- **WHEN** a conversation has 130 messages and the client pages through them using `beforeMessageId` cursors starting from the newest
- **THEN** the union of all pages contains exactly 130 distinct messages in ascending ID order

#### Scenario: Pagination against a file-backed conversation uses the sidecar for reverse paging
- **WHEN** `conversations.getMessages` is called with `beforeMessageId` against a file-backed conversation
- **THEN** the `ConversationMessageStore`'s file implementation uses the sidecar's `lineCount`/`byteLength` to locate the requested slice without a full-file scan, and returns results identical in shape to the SQLite implementation
