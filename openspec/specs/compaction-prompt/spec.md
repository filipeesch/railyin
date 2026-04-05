## Purpose
Defines the structured prompt template used when compacting a conversation, ensuring summaries are consistently organized and contain an analysis scratchpad that is stripped before storage.

## Requirements

### Requirement: Compaction uses a structured multi-section prompt
The system SHALL use a structured compaction prompt that instructs the AI model to produce a summary organized into defined sections: primary request and intent, key technical concepts, files and code sections (with snippets), errors and fixes, problem solving, verbatim user messages, pending tasks, current work, and optional next step.

#### Scenario: Structured prompt is sent during compaction
- **WHEN** a compaction AI call is made (manual or auto)
- **THEN** the system prompt sent to the model is the structured multi-section template, not a single-sentence generic prompt

#### Scenario: Summary contains current work anchor
- **WHEN** a compaction completes
- **THEN** the stored summary includes a "Current Work" section describing what was being done immediately before compaction, with direct quotes from recent messages where available

#### Scenario: Summary preserves verbatim user instructions
- **WHEN** a compaction completes
- **THEN** the stored summary includes an "All User Messages" section listing user turns verbatim (not paraphrased)

### Requirement: Compaction prompt includes an analysis scratchpad phase
The system SHALL instruct the model to write an `<analysis>` reasoning block before the final `<summary>` block, and SHALL strip the `<analysis>` block from the stored summary.

#### Scenario: Analysis block is stripped before storing
- **WHEN** the model response to a compaction call contains an `<analysis>...</analysis>` block
- **THEN** that block is removed before the summary is stored in the database

#### Scenario: Graceful fallback when no analysis block present
- **WHEN** the model response does not contain an `<analysis>` block
- **THEN** the full response is stored as-is without error
