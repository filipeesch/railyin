## ADDED Requirements

### Requirement: Task chat renders a single merged conversation timeline
The task detail chat surface SHALL render one coherent conversation timeline that preserves chronology across persisted conversation history and active execution state. The UI SHALL NOT render persisted messages and structured live stream blocks as two unrelated sections.

#### Scenario: Persisted history and active execution share one visible timeline
- **WHEN** a task conversation has persisted messages and an active execution with structured stream state
- **THEN** the task chat renders one ordered timeline rather than a messages section followed by a separate stream block section

#### Scenario: Mixed reasoning, tool, and assistant output preserves chronology
- **WHEN** a task execution emits reasoning, tool calls, tool results, and assistant output in one run
- **THEN** the rendered task timeline preserves their chronological order as one conversation

### Requirement: Active execution appears as a live tail after persisted history
While a task execution is active, the task chat SHALL render the current execution as a live tail appended after the loaded persisted history. When the execution is reconciled into persisted messages, the live tail SHALL be removed without duplicating content.

#### Scenario: Active execution tail appears after message history
- **WHEN** a task conversation is open and a new execution starts
- **THEN** the conversation shows existing persisted history followed by the active execution tail

#### Scenario: Live tail reconciles on completion
- **WHEN** the execution finishes and the final persisted conversation messages are available
- **THEN** the live execution tail is replaced by the persisted timeline content with no duplicated assistant, reasoning, or tool blocks
