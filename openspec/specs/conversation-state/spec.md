## Purpose
Defines shared frontend conversation state keyed by conversation ID across task and standalone session chat.

## Requirements

### Requirement: Shared conversation state is keyed by conversationId
The system SHALL maintain shared frontend conversation state keyed by `conversationId` so both task chat and standalone session chat use the same message-loading and stream-state machinery.

#### Scenario: Task chat reads shared conversation state
- **WHEN** a task chat view is opened for a task with a conversation ID
- **THEN** the UI reads messages and stream state from the shared conversation state keyed by that conversation ID

#### Scenario: Session chat reads shared conversation state
- **WHEN** a standalone session view is opened for a session with a conversation ID
- **THEN** the UI reads messages and stream state from the same shared conversation state keyed by that conversation ID

### Requirement: Shared conversation state survives drawer visibility changes
The shared conversation state SHALL continue accumulating live stream state even when the current drawer view is closed or switched.

#### Scenario: Stream state survives task drawer close
- **WHEN** a task conversation is streaming and the drawer is closed and reopened
- **THEN** the accumulated stream state is still available from shared conversation state

#### Scenario: Stream state survives switching between task and session drawers
- **WHEN** the user switches from one open conversation to another while the first is still streaming
- **THEN** each conversation preserves its own independent live stream state keyed by `conversationId`

### Requirement: Task-specific side effects subscribe through hooks
The shared conversation state SHALL allow task-specific side effects to subscribe without embedding task-only logic inside shared conversation mechanics.

#### Scenario: File diff side effect triggered through subscription
- **WHEN** a conversation stream event representing a file diff arrives for a task-backed conversation
- **THEN** the task domain receives the subscribed side effect callback and refreshes changed-file state

#### Scenario: Non-active task content triggers unread callback
- **WHEN** assistant or related content arrives for a non-active task-backed conversation
- **THEN** the task domain receives the subscribed unread callback without the shared conversation store requiring direct task-store imports

### Requirement: Playwright coverage for stream state isolation between concurrent conversations
The system SHALL have Playwright test coverage verifying that two open conversations maintain independent stream state and that switching drawers does not cause cross-contamination of streamed content.

#### Scenario: Stream content from task A is not visible in task B
- **WHEN** task A's conversation has streamed "Hello from A" and the user opens task B's drawer
- **THEN** task B's `.conv-body` does not contain "Hello from A"

#### Scenario: Stream state for task A persists after switching to session and back
- **WHEN** task A has streamed content, the user opens a session drawer, then returns to task A
- **THEN** task A's streamed content is still visible in the conversation body
