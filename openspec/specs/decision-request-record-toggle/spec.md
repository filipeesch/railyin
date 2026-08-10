## Purpose
Defines the "Record as decisions" toggle in the DecisionRequest UI, and the recordAsDecisions flag that flows from the UI through stores and RPC to the backend decision-submission layer.

## Requirements

### Requirement: DecisionRequest has a "Record as decisions" toggle
`DecisionRequest.vue` SHALL render a checkbox labeled "Record as decisions" near the Submit button, checked by default. The checkbox state SHALL be included in the submit emit payload as `recordAsDecisions: boolean`. When unchecked, answers are still formatted and displayed identically, but the model is told not to persist them as formal decision records.

#### Scenario: Toggle defaults to checked
- **WHEN** a decision request form is rendered
- **THEN** the "Record as decisions" checkbox is present and checked

#### Scenario: Unchecking toggle and submitting sends recordAsDecisions=false
- **WHEN** the user unchecks "Record as decisions" and clicks Submit
- **THEN** the emitted payload contains `recordAsDecisions: false`

#### Scenario: Leaving toggle checked sends recordAsDecisions=true
- **WHEN** the user leaves "Record as decisions" checked and clicks Submit
- **THEN** the emitted payload contains `recordAsDecisions: true`

### Requirement: MessageBubble and stores thread recordAsDecisions to RPC
`MessageBubble.vue` SHALL extract `recordAsDecisions` from the interview submit payload and pass it to `taskStore.submitDecisions` and `chatStore.submitDecisions`. Both store methods SHALL accept an optional `recordAsDecisions` parameter (default `true`) and include it in their RPC calls.

#### Scenario: Task submission passes recordAsDecisions
- **WHEN** `onInterviewSubmit` fires with `recordAsDecisions: false` for a task context
- **THEN** `taskStore.submitDecisions` is called with `recordAsDecisions: false`

#### Scenario: Session submission passes recordAsDecisions
- **WHEN** `onInterviewSubmit` fires with `recordAsDecisions: false` for a chat session context
- **THEN** `chatStore.submitDecisions` is called with `recordAsDecisions: false`

#### Scenario: Default recordAsDecisions when omitted
- **WHEN** `submitDecisions` is called without a `recordAsDecisions` argument
- **THEN** the store defaults it to `true`

### Requirement: RPC params include recordAsDecisions
Both `tasks.submitDecisions` and `chatSessions.submitDecisions` RPC param types SHALL include an optional `recordAsDecisions?: boolean`. Existing callers that omit it continue to behave as `true`.

#### Scenario: tasks.submitDecisions accepts recordAsDecisions
- **WHEN** the frontend calls `tasks.submitDecisions` with `recordAsDecisions: false`
- **THEN** the backend receives the value

#### Scenario: chatSessions.submitDecisions accepts recordAsDecisions
- **WHEN** the frontend calls `chatSessions.submitDecisions` with `recordAsDecisions: false`
- **THEN** the backend receives the value
