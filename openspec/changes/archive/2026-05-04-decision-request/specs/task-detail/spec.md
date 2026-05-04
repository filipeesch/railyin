## ADDED Requirements

### Requirement: Task drawer exposes a Decisions tab
The system SHALL add a `"decisions"` tab to the task detail drawer toolbar alongside the existing `"chat"` and `"info"` tabs. When the Decisions tab is selected, the `DecisionsPanel` component SHALL be rendered with the task's `conversationId`. When the user switches back to Chat, `ConversationPanel` SHALL be shown and `DecisionsPanel` SHALL be hidden.

#### Scenario: Decisions tab navigates to panel
- **WHEN** the user clicks the Decisions tab in the task drawer toolbar
- **THEN** `DecisionsPanel` is rendered with the correct conversationId and `ConversationPanel` is hidden

#### Scenario: Switching back to chat restores conversation
- **WHEN** the user switches from the Decisions tab back to Chat
- **THEN** `ConversationPanel` is visible and `DecisionsPanel` is hidden

#### Scenario: Decisions tab shows correct count badge
- **WHEN** the conversation has at least one non-deleted decision record
- **THEN** the Decisions tab label or badge reflects the count of records
