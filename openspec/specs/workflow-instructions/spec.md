## Purpose
<!-- TBD: Expand once the capability is fully implemented -->
Defines how workflow templates expose a top-level `workflow_instructions` field that is prepended to the system instructions for every AI execution within that workflow.

## Requirements

### Requirement: Workflow templates support workflow-level instructions
The system SHALL allow a `WorkflowTemplateConfig` to define an optional `workflow_instructions` field. When present, its content SHALL be prepended to the `systemInstructions` passed to every AI execution across all columns in that workflow, regardless of which column the task is currently in. Column-specific `stage_instructions` SHALL NOT be included in `systemInstructions`; it is delivered separately via `userContent` (see the `stage-instructions-injection` capability).

#### Scenario: workflow_instructions present
- **WHEN** a workflow defines `workflow_instructions: "You are in the Delivery workflow."`
- **THEN** the AI request system message contains `"You are in the Delivery workflow."`

#### Scenario: workflow_instructions and stage_instructions both present
- **WHEN** a workflow defines `workflow_instructions: "Workflow context."` and the current column defines `stage_instructions: "Column context."`
- **THEN** the AI request system message contains only `"Workflow context."` (plus any custom prompts) — `stage_instructions` does NOT appear in the system message
- **AND** `"Column context."` appears instead in the `userContent` sent for that execution, as a `stageInstructionsBlock`

#### Scenario: workflow_instructions absent
- **WHEN** a workflow does not define `workflow_instructions`
- **THEN** the system message contains only custom prompts (if any); `stage_instructions`, if present for the column, still does not appear in the system message and is instead delivered via `userContent`
