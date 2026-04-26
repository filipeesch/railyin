## ADDED Requirements

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
