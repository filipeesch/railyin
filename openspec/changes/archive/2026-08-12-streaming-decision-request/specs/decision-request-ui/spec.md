## Purpose

Defines the UI components for presenting decision requests to users and displaying decision records within the conversation drawers.

## Requirements

### Requirement: DecisionRequest component supports pagination
The `DecisionRequest.vue` component SHALL support paginated rendering of interview questions: one question per page with a footer containing Back, Next (non-last pages), and Submit (last page). Per-page answer state (single/multi selection, freetext, other, notes) SHALL be preserved when navigating between pages. Per-question `context` SHALL render as a preamble on its page.

#### Scenario: Component paginates multiple questions
- **WHEN** the component receives more than one question
- **THEN** only the first question page is shown initially
- **AND** the footer shows Next on non-last pages and Submit on the last page
- **AND** Back returns to the previous page with answers preserved

#### Scenario: Single question shows Submit directly
- **WHEN** the component receives exactly one question
- **THEN** the footer shows Submit (no Next)

#### Scenario: Per-question context rendered on its page
- **WHEN** a question carries a `context` string
- **THEN** the context preamble renders above that question's text on its page

#### Scenario: Next is gated by per-page validity
- **WHEN** the current page's question is not yet validly answered
- **THEN** the Next button is disabled
- **AND** once the page is validly answered the Next button is enabled (non-last pages)

#### Scenario: Pagination helpers are pure and testable
- **WHEN** the pagination state is driven via the extracted pure helpers in `src/mainview/utils/decisionRequest.ts`
- **THEN** page advancement, per-page validity, and answer-state preservation are unit-testable without a Vue component harness

### Requirement: DecisionInterviewPanel is a fixed panel above the prompt input
The system SHALL provide a `DecisionInterviewPanel.vue` component that renders the live streaming interview in a fixed position above the todo list / changed-files list and above the prompt input, outside the chat message stream. It SHALL be mounted in `TaskChatView.vue` and `SessionChatView.vue` between the conversation body and the changed-files/todo panels. The panel SHALL read live pages from the conversation store's live-interview state and reconcile to the persisted `decision_request_prompt` at turn end.

#### Scenario: Panel mounted in task chat view
- **WHEN** a task chat tab is active
- **THEN** `DecisionInterviewPanel` is rendered above `ChangedFilesPanel`/`TodoPanel` and above `ConversationInput`

#### Scenario: Panel mounted in session chat view
- **WHEN** a chat session chat tab is active
- **THEN** `DecisionInterviewPanel` is rendered above `ConversationInput`

#### Scenario: Panel absent when no interview is active
- **WHEN** no `decision_request_page` events or persisted `decision_request_prompt` exist for the conversation
- **THEN** the panel is not rendered (no empty box)

### Requirement: Panel closes after the interview is answered
The `DecisionInterviewPanel` SHALL close (not render) once the interview has been answered — i.e. a user message appears AFTER the latest persisted `decision_request_prompt` in the conversation. This makes the panel disappear after the user submits their responses.

#### Scenario: Panel closes after submit
- **WHEN** the user answers the interview and submits, and the resulting user message is appended to the conversation
- **THEN** the panel is no longer visible (no empty box remains)

### Requirement: Dismiss button closes the panel without answering
The `DecisionInterviewPanel` SHALL provide a dismiss control that closes the panel without submitting answers or sending anything to the model. The dismissed state SHALL be per-conversation and reset when switching conversations.

#### Scenario: Dismiss hides the panel
- **WHEN** the user clicks the panel's dismiss button
- **THEN** the panel is no longer visible
- **AND** no submitDecisions RPC is called

#### Scenario: Dismiss resets on conversation switch
- **WHEN** the user dismisses the panel and then switches to another conversation and back
- **THEN** the panel may render again for a new/active interview

### Requirement: Live pages stream into the panel from ephemeral events
The conversation store SHALL maintain a live-interview state per conversation, appending a page for each ephemeral `decision_request_page` stream event received while the execution is running. The panel SHALL render these pages live. When the terminal `decision_request_prompt` is persisted, the live pages SHALL reconcile to the persisted payload (the panel becomes the final interview).

#### Scenario: Page appended per stream event
- **WHEN** the store receives a `decision_request_page` stream event
- **THEN** a new page is appended to the live interview state
- **AND** the panel renders the new page without a full reload

#### Scenario: Terminal prompt replaces live state
- **WHEN** the execution ends and a persisted `decision_request_prompt` message arrives
- **THEN** the panel's questions match the persisted payload and Submit becomes active

### Requirement: In-chat interview rendering retired for new interviews
The `MessageBubble.vue` component SHALL NOT render the live interview form for new interviews (the panel is the single surface). Legacy persisted `decision_request_prompt` messages SHALL remain renderable for backward compatibility where needed.

#### Scenario: New interview not rendered inside chat bubble
- **WHEN** a new interview streams and finalizes
- **THEN** the chat message stream shows the prompt as a lightweight/legacy entry (or none) and the interactive form lives in the fixed panel

#### Scenario: Legacy persisted prompts still render
- **WHEN** a `decision_request_prompt` message predating this change is loaded
- **THEN** it remains renderable in the chat (answered/read-only or fallback form)
