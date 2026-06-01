# Spec: Stream Contamination Test Coverage

## Overview

Requirements for test coverage of cross-chat stream contamination scenarios, ensuring that background task stream events cannot leak into the active conversation view.

## Requirements

### Requirement: sendMessage for background task does not mutate activeConversationId

#### Scenario: T-SC-1 — sendMessage for non-active task skips setActiveConversation
- **WHEN** `taskStore.sendMessage` is called for a task that is not the active task
- **THEN** `conversationStore.activeConversationId` remains unchanged
- **AND** no message is appended to the active conversation

#### Scenario: T-SC-2 — sendMessage for active task still appends message (regression guard)
- **WHEN** `taskStore.sendMessage` is called for the currently active task
- **THEN** the returned message is appended to the active conversation
- **AND** `conversationStore.activeConversationId` remains the active task's conversation ID

#### Scenario: T-SC-3 — drainQueue via onTaskUpdated for background task does not contaminate
- **WHEN** a background task has a queued message and transitions to `executionState: "completed"` via `onTaskUpdated`
- **THEN** the drain fires `sendMessage` for the background task
- **AND** `conversationStore.activeConversationId` is unchanged
- **AND** no messages appear in the active conversation

### Requirement: streamStates memory does not grow unboundedly

#### Scenario: SB-NEW-3 — multiple done events for non-active conversations do not accumulate
- **WHEN** `done` stream events arrive for 10 different non-active conversations
- **THEN** `streamStates.size` equals `0` after all events are processed
