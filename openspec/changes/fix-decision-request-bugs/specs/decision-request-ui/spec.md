## MODIFIED Requirements

### Requirement: Panel closes after the interview is answered
The `DecisionInterviewPanel` SHALL close (not render) once the interview has been answered. The panel SHALL treat the interview as answered when a user message exists whose id is greater than the latest persisted `decision_request_prompt` id, OR when the conversation has clearly moved past the interview: a persisted `decision_request_prompt` exists while the task/session execution state is neither `waiting_user` nor `running` and no live pages are streaming. This guarantees an answered interview never reappears — including after an early submission that persisted the answer message before the terminal prompt, after reloads, and after dropped websocket pushes.

#### Scenario: Panel closes after submit
- **WHEN** the user answers the interview and submits, and the resulting user message is appended to the conversation
- **THEN** the panel is no longer visible (no empty box remains)

#### Scenario: Panel stays closed after drawer reopen
- **WHEN** the user closes the drawer and reopens it after the interview was answered
- **THEN** the panel does not render the answered interview

#### Scenario: Panel closes for raced/legacy data (answer before prompt)
- **WHEN** a persisted `decision_request_prompt` exists but the conversation has moved past it (execution state no longer waiting on the interview, no live pages streaming)
- **THEN** the panel does not render the interview

### Requirement: Dismiss button closes the panel without answering
The `DecisionInterviewPanel` SHALL provide a dismiss control that closes the panel without submitting answers or sending anything to the model. Dismissal SHALL be scoped to the current interview episode AND SHALL persist across drawer reopen for that episode: the dismissed episode key (latest prompt id or live execution id) SHALL be stored in the conversation store so a remounted panel stays hidden. A NEW interview episode (pages arriving from a different execution, or a new latest prompt id) SHALL clear the dismissal and allow the panel to spawn again.

#### Scenario: Dismiss hides the panel
- **WHEN** the user clicks the panel's dismiss button
- **THEN** the panel is no longer visible
- **AND** no submitDecisions RPC is called

#### Scenario: Dismiss persists across drawer reopen
- **WHEN** the user dismisses the panel, closes the drawer, and reopens it for the same interview episode
- **THEN** the panel remains hidden (dismissal persisted per episode)

#### Scenario: Dismiss resets on a new interview episode
- **WHEN** the user dismisses the panel and a new execution streams new question pages afterward (or a new terminal prompt is persisted)
- **THEN** the panel renders again for the new questions

### Requirement: In-chat interview rendering removed entirely
The `MessageBubble.vue` component SHALL NOT render `decision_request_prompt` messages in the chat stream at all — not the interactive form, not an answered summary, not a hint. The persisted message SHALL remain in the conversation history and continue to feed the fixed `DecisionInterviewPanel` and the decision-context injector, but SHALL render nothing inside `MessageBubble`.

#### Scenario: New interview not rendered inside chat bubble
- **WHEN** a new interview streams and finalizes
- **THEN** the chat message stream shows no balloon for the interview
- **AND** the interactive form lives only in the fixed panel above the prompt input

#### Scenario: Legacy persisted prompts render nothing
- **WHEN** a `decision_request_prompt` message predating this change is loaded
- **THEN** it renders nothing in the chat stream (no balloon, no hint, no answered summary)

## ADDED Requirements

### Requirement: Resize handle grows the panel upward
The resize handle on the panel's top edge SHALL increase the panel body height when dragged UP and decrease it when dragged DOWN (the panel's bottom is fixed in the drawer flow; the chat sits above the panel). Double-clicking the handle SHALL reset the body height to the default.

#### Scenario: Drag up enlarges
- **WHEN** the user drags the resize handle upward
- **THEN** the panel body height increases (capped at 70% of the viewport)

#### Scenario: Drag down shrinks
- **WHEN** the user drags the resize handle downward
- **THEN** the panel body height decreases (floored at the minimum height)

#### Scenario: Double-click resets
- **WHEN** the user double-clicks the resize handle after resizing
- **THEN** the panel body height returns to the default

### Requirement: Footer is fixed; only question content scrolls
The interview footer (Back, question counter, Record-as-decisions toggle, and the primary Next/Submit action) SHALL remain visible (fixed) at the bottom of the panel while the vertical overflow scrollbar SHALL be confined to the question content area (context preamble, question, options, notes, general notes).

#### Scenario: Long content scrolls inside the content area
- **WHEN** a question's content is taller than the panel body
- **THEN** only the question content area scrolls
- **AND** the footer remains fully visible without scrolling

#### Scenario: Footer always reachable
- **WHEN** the user scrolls to the bottom of a long interview
- **THEN** the Back/Next/Submit footer is still visible (fixed, not scrolled away)
