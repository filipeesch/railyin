## MODIFIED Requirements

### Requirement: Compaction uses a structured multi-section prompt
The system SHALL use a structured compaction prompt that instructs the AI model to produce a summary organized into defined sections: primary request and intent, key technical concepts, files and code sections (with snippets), errors and fixes, problem solving, verbatim user messages, pending tasks, current work, and optional next step.

The "Pending Tasks" section (section 7) SHALL instruct the model that todos managed by the todo system are already persisted and re-injected separately — the compaction summary SHALL NOT re-summarize them. If no todo tool is active or no todos exist, the model MAY record pending items in prose as today.

#### Scenario: Structured prompt is sent during compaction
- **WHEN** a compaction AI call is made (manual or auto)
- **THEN** the system prompt sent to the model is the structured multi-section template, not a single-sentence generic prompt

#### Scenario: Summary contains current work anchor
- **WHEN** a compaction completes
- **THEN** the stored summary includes a "Current Work" section describing what was being done immediately before compaction, with direct quotes from recent messages where available

#### Scenario: Summary preserves verbatim user instructions
- **WHEN** a compaction completes
- **THEN** the stored summary includes an "All User Messages" section listing user turns verbatim (not paraphrased)

#### Scenario: Pending Tasks section defers to todo system when todos exist
- **WHEN** a compaction completes and the task has active todos
- **THEN** the "Pending Tasks" section in the stored summary references the todo system instead of enumerating todo items in prose, to avoid drift

#### Scenario: Pending Tasks section used normally when no todos exist
- **WHEN** a compaction completes and the task has no todos
- **THEN** the "Pending Tasks" section in the stored summary may contain prose as before
