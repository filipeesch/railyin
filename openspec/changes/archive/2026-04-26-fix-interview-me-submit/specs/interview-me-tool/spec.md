## MODIFIED Requirements

### Requirement: Chat widget renders interview_prompt as a structured deliberation UI
The system SHALL render `interview_prompt` messages as an interactive `InterviewMe` widget. The widget SHALL display an optional `context` preamble, followed by each question in sequence. For each question the widget SHALL render a list of option rows, a fixed-height markdown description panel below the options, and a Notes textarea (except for `freetext` questions and when "Other" is selected).

The widget SHALL gate the Submit button on all questions being answered. A question is considered answered when:
- `exclusive`: one option row has been selected (by clicking the row OR the radio control)
- `non_exclusive`: at least one option row has been checked (by clicking the row OR the checkbox control)
- `freetext`: the textarea contains at least one non-whitespace character

For `non_exclusive` questions, clicking an option row SHALL both open its description panel AND toggle the option's checked state, matching the selection behavior of `exclusive` rows.

#### Scenario: Context preamble is rendered above questions

- **WHEN** the `interview_prompt` payload includes a `context` field
- **THEN** the widget renders the context as markdown above the first question

#### Scenario: Exclusive question row click selects the option and enables submit

- **WHEN** the user clicks an option row for an `exclusive` question
- **THEN** the option becomes selected AND the Submit button becomes enabled (if all other questions are also answered)

#### Scenario: non_exclusive question row click toggles the option and enables submit

- **WHEN** the user clicks an option row for a `non_exclusive` question
- **THEN** the option's checked state is toggled AND the Submit button becomes enabled once at least one option is checked (and all other questions are answered)

#### Scenario: non_exclusive question row click a second time deselects the option

- **WHEN** the user clicks an already-checked option row for a `non_exclusive` question
- **THEN** the option is deselected and the Submit button becomes disabled if no options remain checked

#### Scenario: Freetext question becomes answered when non-empty text is entered

- **WHEN** the user types text into a `freetext` question textarea
- **THEN** the Submit button becomes enabled once all questions have a non-empty answer

#### Scenario: Submit button is disabled when any question is unanswered

- **WHEN** a batch interview has multiple questions and at least one is unanswered
- **THEN** the Submit button remains disabled until all questions are answered

#### Scenario: Answered interview is rendered read-only

- **WHEN** a `user` message exists after the `interview_prompt` message in the conversation
- **THEN** the widget renders in read-only state showing answer summaries with no Submit button visible

#### Scenario: Reactive state is consistent when questions prop changes after mount

- **WHEN** the `questions` prop of the `InterviewMe` component is updated after the component has mounted
- **THEN** all per-question selection state is reset to empty so the widget reflects the new question set correctly
