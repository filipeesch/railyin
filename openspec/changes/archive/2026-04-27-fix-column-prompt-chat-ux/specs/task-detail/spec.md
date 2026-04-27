## ADDED Requirements

### Requirement: Entered-column transitions render as structured chat cards
The task detail chat SHALL render `transition_event` messages for column-entry automation as structured transition cards instead of a minimal text row plus a dominant raw prompt bubble. The collapsed card SHALL use exact workflow wording and show both target and source workflow states when available.

#### Scenario: Collapsed transition card shows exact workflow wording
- **WHEN** the conversation contains a `transition_event` for a workflow move
- **THEN** the task chat shows a transition card summary using the exact workflow wording for the move, including both target and source states when the source exists

#### Scenario: Transition card remains the primary visible artifact for prompted entry
- **WHEN** the task enters a column with automation metadata in the `transition_event`
- **THEN** the transition card remains the primary visible artifact in the timeline rather than a raw prompt-first bubble

### Requirement: Transition cards expose entered-column instructions through collapsed disclosure
For prompted column entry, the task detail chat SHALL render the entered-column instructions inside an expandable disclosure owned by the transition card. The disclosure SHALL be collapsed by default.

#### Scenario: Prompted transition card starts collapsed
- **WHEN** the task chat renders a `transition_event` that includes entered-column instruction detail
- **THEN** the instructions are hidden by default behind a disclosure control

#### Scenario: Expanding the card reveals instructions
- **WHEN** the user expands the disclosure on a prompted transition card
- **THEN** the entered-column instruction text becomes visible within the card body

### Requirement: Expanded transition instructions reuse normal chat chip styling
The expanded instruction body for a prompted transition card SHALL render prompt-like references using the same inline chip styling language used for normal chat prompt content, rather than a monolithic raw code block. Visible source or provenance rows SHALL NOT be shown in the expanded UI.

#### Scenario: Slash-style references render as chips inside expanded instructions
- **WHEN** the expanded instruction text contains a slash-style reference that maps to the chat chip rendering rules
- **THEN** the transition card renders that reference using the same inline chip styling used in normal chat prompts

#### Scenario: Slash-based instructions do not leak resolved prompt bodies
- **WHEN** the transition metadata contains both a resolved instruction body and an authored slash source reference
- **THEN** the expanded transition card shows the authored slash-based instruction text instead of the resolved prompt body

#### Scenario: Expanded transition instructions omit visible provenance rows
- **WHEN** the user expands a prompted transition card
- **THEN** the UI shows only the entered-column instruction content and does not show a visible source/provenance row
