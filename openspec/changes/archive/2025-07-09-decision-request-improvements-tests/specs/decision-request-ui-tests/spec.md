## ADDED Requirements

### Requirement: General notes textarea visible on all decision forms
The `DecisionRequest` component SHALL always render a general notes textarea, regardless of question type or count.

#### Scenario: T-L — general notes visible
- **WHEN** a `decision_request_prompt` message is rendered with any question type
- **THEN** the `.interview__general-notes` area is visible with label "Additional context"

### Requirement: General notes included in submitted message
When the user types in the general notes textarea and submits, the submitted message content SHALL include the notes.

#### Scenario: T-M — notes appear in message bubble
- **WHEN** the user fills in general notes and clicks Submit
- **THEN** the outgoing message bubble contains "General notes: <typed value>"

### Requirement: Submission without notes omits notes section
When the user submits without typing any general notes, the submitted message SHALL NOT contain a "General notes" section.

#### Scenario: T-N — no notes section when empty
- **WHEN** the user submits without filling in general notes
- **THEN** the outgoing message does NOT contain "General notes"

### Requirement: Decision form submissions route to submitDecisions RPC
Clicking Submit on a `decision_request_prompt` SHALL call `tasks.submitDecisions` (for tasks) or `chatSessions.submitDecisions` (for sessions) — NOT `sendMessage`.

#### Scenario: T-O — tasks.submitDecisions is called on submit
- **WHEN** the user selects an option and clicks Submit on a task interview form
- **THEN** `tasks.submitDecisions` mock handler is invoked with the answer
- **AND** `tasks.sendMessage` mock handler is NOT invoked

## MODIFIED Requirements

### Requirement: T-E — Submit calls submitDecisions not sendMessage
The T-E scenario previously tested that submit calls `tasks.sendMessage`. This MUST now verify `tasks.submitDecisions`.

#### Scenario: T-E — clicking submit calls tasks.submitDecisions
- **WHEN** the user selects an exclusive option and clicks Submit
- **THEN** `tasks.submitDecisions` is called with an `answers` array containing the selected option title
- **AND** `tasks.sendMessage` is NOT called

### Requirement: CD-D-6 — Session submit routes to chatSessions.submitDecisions
The CD-D-6 scenario previously tested `chatSessions.sendMessage`. This MUST now verify `chatSessions.submitDecisions`.

#### Scenario: CD-D-6 — clicking submit in session form calls chatSessions.submitDecisions
- **WHEN** the user selects an option and clicks Submit in a chat session interview form
- **THEN** `chatSessions.submitDecisions` is called with the selected answer
