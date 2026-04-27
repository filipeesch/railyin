## ADDED Requirements

### Requirement: Column prompt chat UX has backend integration coverage
The automated test suite SHALL include in-memory backend integration coverage for the column prompt chat UX feature using the existing SQLite test harness and injected collaborators rather than alternate runtime paths.

#### Scenario: Prompted transition persists enriched transition metadata
- **WHEN** the backend transition coverage runs for a task entering a column with `on_enter_prompt`
- **THEN** it verifies that the resulting `transition_event` row contains the instruction detail metadata required by the feature spec

#### Scenario: Prompted transition does not depend on a standalone visible prompt row
- **WHEN** the backend transition coverage runs for a prompted column entry
- **THEN** it verifies that the user-visible history contract is satisfied without requiring a standalone visible `user(role="prompt")` row

#### Scenario: Execution wiring matches transition detail
- **WHEN** the backend transition coverage runs for a prompted column entry
- **THEN** it verifies that the prompt prepared for execution is consistent with the instruction detail exposed for conversation rendering

### Requirement: Column prompt chat UX has frontend pure-helper coverage
The automated test suite SHALL include frontend Vitest coverage for pure helper logic used by the column prompt chat UX feature, without requiring a new mounted component test harness.

#### Scenario: Transition summary formatting is covered
- **WHEN** the frontend helper coverage runs
- **THEN** it verifies summary formatting for transitions with source and target states, including safe fallback behavior for partial metadata

#### Scenario: Transition metadata normalization is covered
- **WHEN** the frontend helper coverage runs
- **THEN** it verifies both legacy transition metadata and enriched transition metadata are normalized without crashing the conversation UI

#### Scenario: Prompt-like chip segmentation reuse is covered
- **WHEN** the frontend helper coverage runs
- **THEN** it verifies the instruction text path preserves inline chip ordering for slash, file, and tool-like prompt references when those references map to the shared chat chip rules

### Requirement: Column prompt chat UX has Playwright task-chat coverage
The automated test suite SHALL include Playwright coverage for the structured transition-card UX in the task chat timeline using mocked API and WebSocket fixtures.

#### Scenario: Transition card renders exact workflow wording
- **WHEN** the Playwright task-chat coverage runs with a `transition_event` containing prompted transition metadata
- **THEN** it verifies the task drawer shows the transition card summary using the exact workflow wording with source and target states when present

#### Scenario: Transition instructions are collapsed by default
- **WHEN** the Playwright task-chat coverage runs with a prompted transition card
- **THEN** it verifies the instruction body is hidden until the disclosure is expanded

#### Scenario: Expanded instruction body omits visible provenance
- **WHEN** the user expands the prompted transition card in the Playwright task-chat coverage
- **THEN** it verifies the card shows the entered-column instruction content without a visible provenance/source row

#### Scenario: Slash-based transition instructions stay authored in the visible UI
- **WHEN** the Playwright task-chat coverage runs with prompted transition metadata that contains both resolved instruction text and an authored slash source
- **THEN** it verifies the expanded card shows the authored slash-based instruction text and does not leak the resolved prompt body

#### Scenario: Legacy and new transition histories coexist readably
- **WHEN** the Playwright task-chat coverage runs with a conversation containing both legacy prompt-row history and new transition-card history
- **THEN** it verifies the timeline remains readable and ordered without duplicating the new prompted transition presentation
