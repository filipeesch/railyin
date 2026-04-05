## Purpose

The `ask_user` tool gives the AI model a structured mechanism to request user input mid-execution. When called, it suspends the execution loop and presents the user with a question, a set of options, and a free-text fallback.

## Requirements

### Requirement: Model can call ask_user to request structured input

The system SHALL expose an `ask_me` tool to the model when included in the column's tool configuration. The tool SHALL accept a `questions` array (each item with `question`, `selection_mode`, and `options`). Each option SHALL be an object with required `label` and optional `description`, `recommended`, and `preview` fields. The legacy schema (top-level `question`, `selection_mode`, `options` as strings) SHALL continue to work for backward compatibility.

#### Scenario: ask_user tool definition is sent to model with extended schema

- **WHEN** a column configuration includes `ask_user` in its `tools` list
- **THEN** the AI request includes the `ask_me` tool definition with the extended option object schema including `label`, `description`, `recommended`, and `preview` fields (all optional except `label`)

#### Scenario: ask_user is not offered when absent from column tools

- **WHEN** a column configuration does not include `ask_user` in its `tools` list
- **THEN** the AI request does NOT include the `ask_user` tool definition

### Requirement: Engine intercepts ask_user call and suspends execution

The system SHALL intercept an `ask_me` tool call before executing it. On interception, the engine SHALL save the questions and options (including all new metadata fields) as an `ask_user_prompt` conversation message, set `execution_state` to `waiting_user`, and return without continuing the tool loop.

#### Scenario: ask_user call suspends execution

- **WHEN** the model returns an `ask_me` tool call during the tool loop
- **THEN** the engine saves an `ask_user_prompt` message with all question and option data, sets `execution_state = 'waiting_user'`, and exits the tool loop

#### Scenario: Tool loop does not continue after ask_user

- **WHEN** the engine intercepts an `ask_me` call
- **THEN** no further tool calls in the same turn are executed

### Requirement: Chat widget renders ask_user_prompt message as structured UI

The system SHALL render conversation messages of type `ask_user_prompt` as an interactive widget. For each question in the `questions` array, the widget SHALL display the question text, options (with label, optional description, optional recommended badge, optional preview), and always include an "Other (specify)" free-text option.

#### Scenario: Single-select renders as radio buttons

- **WHEN** an `ask_user_prompt` question has `selection_mode: "single"`
- **THEN** the widget renders each option as a radio button and includes an "Other" radio option with a text input

#### Scenario: Multi-select renders as checkboxes

- **WHEN** an `ask_user_prompt` question has `selection_mode: "multi"`
- **THEN** the widget renders each option as a checkbox and includes an "Other" checkbox with a text input

#### Scenario: Multiple questions rendered sequentially

- **WHEN** an `ask_user_prompt` message contains more than one question
- **THEN** each question is rendered as its own section within the widget, stacked vertically

#### Scenario: Submitting sends user message and resumes execution

- **WHEN** the user submits their selections for all questions via the widget
- **THEN** the answers are sent as a regular user message and execution resumes

### Requirement: ask_user_prompt widget is read-only after submission

The system SHALL render the `ask_user_prompt` widget in a read-only state once the user has submitted their response, showing the selected options but disabling all controls.

#### Scenario: Widget becomes read-only after answer submitted

- **WHEN** a user response to an `ask_user_prompt` exists in the conversation
- **THEN** the associated `ask_user_prompt` widget is rendered as read-only with selections shown but controls disabled
