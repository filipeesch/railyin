## Purpose
Conversation pagination enables incremental loading of long conversation histories using cursor-based pagination, so clients can load the newest page first and progressively fetch older messages on demand.

## Requirements

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

### Requirement: Conversation store loads incrementally and merges pages
The system SHALL maintain an `oldestLoadedId` cursor and a `hasMoreBefore` flag in the conversation store. `loadOlderMessages()` SHALL prepend older pages to the existing `messages` array without replacing them. The `refreshLatestPage()` operation (invoked on stream `done`) SHALL preserve already-loaded older pages while refreshing the newest page.

#### Scenario: loadOlderMessages prepends without losing existing pages
- **WHEN** the store has pages 51–100 loaded
- **AND** `loadOlderMessages()` is called
- **THEN** messages 1–50 are prepended and messages 51–100 remain in the array

#### Scenario: Concurrent loadOlderMessages calls are deduplicated
- **WHEN** `loadOlderMessages()` is called while a previous call is still in-flight
- **THEN** the second call is ignored (no duplicate prepend, no race condition)

#### Scenario: refreshLatestPage preserves older history on stream done
- **WHEN** the user has scrolled up and loaded older pages (messages 1–50 prepended)
- **AND** the stream completes and `refreshLatestPage()` is called
- **THEN** messages 1–50 remain in the store and the newest page is refreshed from the backend

### Requirement: Upward infinite scroll triggers incremental history loading
The system SHALL automatically trigger `loadOlderMessages()` when the top of the loaded conversation scrolls into the viewport, without requiring explicit user interaction.

#### Scenario: Scrolling to the top of the loaded list loads older messages
- **WHEN** the user scrolls upward and the sentinel item at the top of the conversation becomes visible
- **THEN** `loadOlderMessages()` is triggered and older messages are prepended

#### Scenario: Sentinel is not rendered when no older history exists
- **WHEN** `hasMoreBefore` is false (all history is loaded)
- **THEN** no sentinel or "load more" indicator is visible at the top of the conversation

#### Scenario: No viewport jump when older messages are prepended
- **WHEN** older messages are prepended to the conversation
- **THEN** the visible viewport content does not shift — the user's current view position is preserved

### Requirement: Opening a long conversation starts at the latest message
The system SHALL render the conversation scrolled to the bottom (newest message) after the initial paginated load, matching the current behavior.

#### Scenario: Drawer opens at bottom for a long conversation
- **WHEN** a task with more than 50 messages is opened
- **THEN** the conversation timeline is scrolled to the most recent message
- **AND** the sentinel (top of list) is off-screen

### Requirement: load-older fires when sentinel is visible at autoScroll disable
`e2e/ui/conversation-pagination.spec.ts` SHALL include PAG-9 verifying that `loadOlderMessages` is triggered when the sentinel element is already within the viewport at the moment `autoScroll` transitions from `true` to `false`. The test uses `evaluate(el => el.scrollTop = 0)` to force the transition, consistent with existing PAG tests.

#### Scenario: PAG-9 — load-older emitted when sentinel already visible on scroll-up
- **WHEN** the conversation has `hasMore: true` with few enough messages that the sentinel is visible
- **AND** `scrollTop` is set to `0` via `evaluate()` to disable autoScroll
- **THEN** `conversations.getMessages` is called a second time (load-older triggered by the watcher)
