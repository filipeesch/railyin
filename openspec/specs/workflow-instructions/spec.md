## Purpose
<!-- TBD: Expand once the capability is fully implemented -->
Defines how workflow templates expose a top-level `workflow_instructions` field that is prepended to the system instructions for every AI execution within that workflow.

## Requirements

### Requirement: Workflow templates support workflow-level instructions
The system SHALL allow a `WorkflowTemplateConfig` to define an optional `workflow_instructions` field. When present, its content SHALL be prepended to the `systemInstructions` passed to every AI execution across all columns in that workflow, regardless of which column the task is currently in.

#### Scenario: workflow_instructions present and no stage_instructions
- **WHEN** a workflow defines `workflow_instructions: "You are in the Delivery workflow."` and the current column has no `stage_instructions`
- **THEN** the AI request system message contains exactly `"You are in the Delivery workflow."`

#### Scenario: Both workflow_instructions and stage_instructions present
- **WHEN** a workflow defines `workflow_instructions: "Workflow context."` and the current column defines `stage_instructions: "Column context."`
- **THEN** the AI request system message contains `"Workflow context.\n\nColumn context."` (workflow first, stage appended)

#### Scenario: workflow_instructions absent
- **WHEN** a workflow does not define `workflow_instructions`
- **THEN** system instruction assembly falls back to `stage_instructions` only, with no change to existing behaviour
