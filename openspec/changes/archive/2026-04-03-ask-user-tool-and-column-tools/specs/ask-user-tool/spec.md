## Purpose

The `ask_user` tool gives the AI model a structured mechanism to request user input mid-execution. When called, it suspends the execution loop and presents the user with a question, a set of options, and a free-text fallback.

## Requirements

### Requirement: Model can call ask_user to request structured input

The system SHALL expose an `ask_user` tool to the model when it is included in the column's tool configuration. The tool accepts a question string, a selection mode, and an array of option strings.

#### Scenario: ask_user tool definition is sent to model

- **WHEN** a column configuration includes `ask_user` in its `tools` list
- **THEN** the AI request includes the `ask_user` tool definition with `question`, `selection_mode`, and `options` parameters

#### Scenario: ask_user is not offered when absent from column tools

- **WHEN** a column configuration does not include `ask_user` in its `tools` list
- **THEN** the AI request does NOT include the `ask_user` tool definition

### Requirement: Engine intercepts ask_user call and suspends execution

The system SHALL intercept an `ask_user` tool call before executing it. On interception, the engine SHALL save the question and options as an `ask_user_prompt` conversation message, set `execution_state` to `waiting_user`, and return without continuing the tool loop.

#### Scenario: ask_user call suspends execution

- **WHEN** the model returns an `ask_user` tool call during the tool loop
- **THEN** the engine saves an `ask_user_prompt` message with the question and options, sets `execution_state = 'waiting_user'`, and exits the tool loop

#### Scenario: Tool loop does not continue after ask_user

- **WHEN** the engine intercepts an `ask_user` call
- **THEN** no further tool calls in the same turn are executed, and no streaming response is initiated

### Requirement: Chat widget renders ask_user_prompt message as structured UI

The system SHALL render conversation messages of type `ask_user_prompt` as an interactive widget in the chat pane. The widget SHALL display the question, the model's options as radio buttons (single) or checkboxes (multi), and always include an "Other (specify)" option with a text input that is enabled when selected.

#### Scenario: Single-select renders as radio buttons

- **WHEN** an `ask_user_prompt` message has `selection_mode: "single"`
- **THEN** the chat widget renders each option as a radio button and includes an "Other" radio option with a text input

#### Scenario: Multi-select renders as checkboxes

- **WHEN** an `ask_user_prompt` message has `selection_mode: "multi"`
- **THEN** the chat widget renders each option as a checkbox and includes an "Other" checkbox with a text input

#### Scenario: Other option enables free text

- **WHEN** the user selects "Other (specify)"
- **THEN** a text input becomes active for the user to enter their own answer

#### Scenario: Submitting sends user message and resumes execution

- **WHEN** the user submits their selection via the widget
- **THEN** the selected options (and any Other text) are sent as a regular user message, and execution resumes via the normal handleHumanTurn flow

### Requirement: ask_user_prompt widget is read-only after submission

The system SHALL render previously answered `ask_user_prompt` messages as read-only summaries in the conversation history. They SHALL show the question and the selected answer but no interactive controls.

#### Scenario: Answered widget is not interactive

- **WHEN** the conversation history contains an `ask_user_prompt` message followed by a user message
- **THEN** the widget is rendered in a read-only/collapsed state showing the selected answer
