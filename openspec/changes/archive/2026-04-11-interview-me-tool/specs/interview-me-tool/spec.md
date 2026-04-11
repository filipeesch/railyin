## Purpose

The `interview_me` tool gives the AI model a structured mechanism to ask complex, high-stakes questions mid-execution. Unlike `ask_me` (quick structured choices), `interview_me` is designed for architectural decisions, technology selection, and constraint gathering — interactions where the user must understand the full implications of each option before choosing.

## Requirements

### Requirement: Model can call interview_me to request deliberate input

The system SHALL expose an `interview_me` tool to the model when included in the column's tool configuration. The tool SHALL accept an optional `context` string (markdown preamble) and a `questions` array. Each question SHALL have `question` text, `type` (`exclusive`, `non_exclusive`, or `freetext`), and optional `weight`, `model_lean`, `model_lean_reason`, and `answers_affect_followup` fields. Questions with type `exclusive` or `non_exclusive` SHALL require an `options` array; each option SHALL have a `title` and a mandatory `description` (markdown).

#### Scenario: interview_me tool definition is sent to model with full schema

- **WHEN** a column configuration includes `interview_me` in its `tools` list
- **THEN** the AI request includes the `interview_me` tool definition with the complete schema and a description that instructs the model to ALWAYS use it instead of plain prose for complex decisions

#### Scenario: interview_me is not offered when absent from column tools

- **WHEN** a column configuration does not include `interview_me` in its `tools` list
- **THEN** the AI request does NOT include the `interview_me` tool definition

### Requirement: Engine intercepts interview_me call and suspends execution

The system SHALL intercept an `interview_me` tool call before executing it in both the native engine and the Copilot engine. On interception, the engine SHALL normalize the payload, save it as an `interview_prompt` conversation message, set `execution_state` to `waiting_user`, and stop the tool loop.

#### Scenario: interview_me call suspends execution

- **WHEN** the model returns an `interview_me` tool call during the tool loop
- **THEN** the engine saves an `interview_prompt` message with the normalized payload, sets `execution_state = 'waiting_user'`, and exits the tool loop

#### Scenario: Empty interview_me call triggers a nudge

- **WHEN** the model calls `interview_me` with missing or empty `questions`
- **THEN** the engine nudges the model (up to 3 times) to retry with valid arguments before skipping

#### Scenario: Tool loop does not continue after interview_me

- **WHEN** the engine intercepts an `interview_me` call
- **THEN** no further tool calls in the same turn are executed

### Requirement: Chat widget renders interview_prompt as a structured deliberation UI

The system SHALL render `interview_prompt` messages as an interactive `InterviewMe` widget. The widget SHALL display an optional `context` preamble, followed by each question in sequence. For each question the widget SHALL render a list of option rows, a fixed-height markdown description panel below the options, and a Notes textarea (except for `freetext` questions and when "Other" is selected).

#### Scenario: Context preamble is rendered above questions

- **WHEN** the `interview_prompt` payload includes a `context` field
- **THEN** the widget renders the context as markdown above the first question

#### Scenario: Weight badge is shown for questions with weight set

- **WHEN** a question has `weight: "critical"` / `"medium"` / `"easy"`
- **THEN** the widget renders a badge next to the question text indicating reversibility

#### Scenario: Model lean is shown for questions with model_lean set

- **WHEN** a question has `model_lean` and `model_lean_reason`
- **THEN** the widget renders a subtle "🤖 I lean toward X · reason" line below the question text

#### Scenario: answers_affect_followup hint is shown when set

- **WHEN** a question has `answers_affect_followup: true`
- **THEN** the widget renders a small "✦ Your answer here will shape follow-up questions" note

#### Scenario: Clicking a row shows its description in the panel below

- **WHEN** the user clicks an option row (not the checkbox)
- **THEN** the description panel updates to show that option's markdown content with an opacity cross-fade; the layout does not shift

#### Scenario: Description panel has fixed dimensions

- **WHEN** the description panel is visible
- **THEN** it has a minimum height of 200px, a maximum height of 400px, and overflows with a scrollbar for longer content

#### Scenario: Single-select row click selects the option

- **WHEN** the question type is `exclusive` and the user clicks a row
- **THEN** that option becomes the selected answer (no separate radio button rendered; row highlight is the affordance)

#### Scenario: Multi-select checkbox click toggles selection independently

- **WHEN** the question type is `non_exclusive` and the user clicks a checkbox
- **THEN** that option is added to or removed from the selection without changing the focused description

#### Scenario: Selecting "Other" replaces the description panel with a textarea

- **WHEN** the user focuses the "Other" row
- **THEN** the description panel is replaced by a free-text textarea; the Notes field is hidden

#### Scenario: Notes textarea is visible for non-freetext questions unless Other is focused

- **WHEN** the question type is `exclusive` or `non_exclusive` AND the focused option is not "Other"
- **THEN** a Notes (optional) textarea is rendered below the description panel

#### Scenario: Freetext question renders only a textarea

- **WHEN** the question type is `freetext`
- **THEN** the widget renders only a textarea with no option list, no description panel, and no Notes field

#### Scenario: Submit is disabled until all questions have a valid answer

- **WHEN** any question has no selection (or Other is selected but its textarea is empty)
- **THEN** the Submit button is disabled

#### Scenario: Submitting sends a structured user message and resumes execution

- **WHEN** the user submits the widget
- **THEN** answers are serialized as a readable multi-line string (Q/A/Notes format per question), sent as a user message, and execution resumes

### Requirement: interview_prompt widget is read-only after submission

The system SHALL render the `interview_prompt` widget in a compact read-only state once the user has submitted, showing each question and its answer summary.

#### Scenario: Widget collapses to read-only summary after submission

- **WHEN** a user response to an `interview_prompt` exists in the conversation
- **THEN** the widget renders a compact list of question → answer pairs with any Notes included, and all controls are disabled
