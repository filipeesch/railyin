## ADDED Requirements

### Requirement: Chat timeline renders only a windowed subset of items at any time
The system SHALL use a virtual scrolling mechanism that keeps at most (visible items + 10 overscan) DOM nodes mounted in the conversation timeline at any given time, regardless of total conversation length.

#### Scenario: Long conversation has bounded DOM nodes
- **WHEN** a task with 200 conversation items is open
- **THEN** the DOM contains no more than approximately 25 rendered conversation item nodes (visible window + overscan buffer)

#### Scenario: Short conversation renders all items
- **WHEN** a task has fewer items than the visible window can hold
- **THEN** all items are rendered normally (virtual list renders the full set)

### Requirement: Virtual timeline preserves auto-scroll-to-bottom during streaming
The system SHALL automatically scroll the conversation timeline to the bottom when new messages arrive and the user has not manually scrolled up.

#### Scenario: New message during auto-scroll mode scrolls to bottom
- **WHEN** the user is at (or within 60px of) the bottom of the conversation
- **AND** a new message or streaming token arrives
- **THEN** the conversation scrolls to the bottom to show the new content

#### Scenario: User scrolled up — new message does not hijack scroll
- **WHEN** the user has scrolled more than 60px above the bottom
- **AND** a new message arrives
- **THEN** the scroll position remains unchanged

#### Scenario: User scrolls back to bottom — auto-scroll resumes
- **WHEN** the user had scrolled up (auto-scroll paused)
- **AND** the user scrolls back within 60px of the bottom
- **THEN** auto-scroll resumes for subsequent messages

### Requirement: Virtual timeline items are dynamically height-measured
The system SHALL measure the rendered height of each virtual item after mount and use those measurements to correctly position all subsequent items in the virtual spacer.

#### Scenario: Tall tool call group is correctly positioned
- **WHEN** a ToolCallGroup with many nested sub-tool-calls renders and is measured
- **THEN** items that follow it in the list are positioned below the full measured height (no overlap)

#### Scenario: Item height changes after expand/collapse
- **WHEN** a ToolCallGroup accordion is expanded or collapsed
- **THEN** the virtual spacer total height updates and subsequent item positions adjust

### Requirement: Switching tasks resets virtual scroll state
The system SHALL reset the virtual scroll position and size cache when the active task changes, so stale height measurements from a previous task do not affect the new task's layout.

#### Scenario: Switching tasks scrolls to bottom of new task
- **WHEN** the user opens a different task
- **THEN** the conversation scrolls to the bottom of the new task's timeline
- **AND** no height measurements from the previous task affect the layout

### Requirement: Live streaming tail renders after the virtual list in normal document flow
The system SHALL render the ReasoningBubble, live streaming token, and status spinner outside the virtual list, in normal document flow immediately after the virtual spacer element.

#### Scenario: Streaming tail is always visible at the bottom during active streaming
- **WHEN** a task is actively streaming tokens
- **THEN** the ReasoningBubble and streaming token div appear at the bottom of the scroll container below all virtual items
- **AND** auto-scroll brings them into view

### Requirement: Virtual timeline includes a load-more sentinel item when older history exists
The system SHALL render a `load_more_sentinel` item as the first virtual list item when `hasMoreBefore` is true. An `IntersectionObserver` SHALL watch this sentinel; when it enters the viewport, `loadOlderMessages()` SHALL be triggered automatically. When `hasMoreBefore` is false, the sentinel SHALL not be rendered and no observer SHALL be active.

#### Scenario: Sentinel is visible at top when older history exists
- **WHEN** a conversation has more than 50 messages and the newest page is loaded
- **AND** the user scrolls to the top of the loaded list
- **THEN** a loading indicator (sentinel) is visible at the top of the conversation

#### Scenario: Sentinel is absent when all history is loaded
- **WHEN** `hasMoreBefore` is false
- **THEN** no sentinel or loading indicator appears at the top of the conversation list

#### Scenario: Sentinel entering viewport triggers load
- **WHEN** the sentinel item scrolls into the visible viewport
- **THEN** `loadOlderMessages()` is emitted exactly once per sentinel visibility event (guard prevents concurrent calls)
