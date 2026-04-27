# Spec: workflow-instructions-test-coverage

## Purpose

Test coverage requirements for the workflow instructions feature — verifying that `buildSystemInstructions()`, `getWorkflowTemplate()`, and `systemInstructions` propagation behave correctly at the unit, integration, and engine levels.

## Requirements

### Requirement: buildSystemInstructions correctly merges workflow and stage instructions
The system SHALL have unit tests verifying that `buildSystemInstructions()` in `column-config.ts` produces the correct merged string for all input combinations.

#### Scenario: Both fields set — workflow first
- **WHEN** a workflow has `workflow_instructions: "W"` and the column has `stage_instructions: "S"`
- **THEN** `buildSystemInstructions()` returns `"W\n\nS"`

#### Scenario: Only workflow_instructions set
- **WHEN** a workflow has `workflow_instructions: "W"` and the column has no `stage_instructions`
- **THEN** `buildSystemInstructions()` returns `"W"`

#### Scenario: Only stage_instructions set
- **WHEN** a workflow has no `workflow_instructions` and the column has `stage_instructions: "S"`
- **THEN** `buildSystemInstructions()` returns `"S"`

#### Scenario: Neither field set — returns undefined
- **WHEN** neither `workflow_instructions` nor `stage_instructions` is defined
- **THEN** `buildSystemInstructions()` returns `undefined`, not an empty string

#### Scenario: Empty string fields are treated as absent
- **WHEN** either field is set to an empty string `""`
- **THEN** it is filtered out, behaving the same as if the field were omitted

#### Scenario: Column not found — returns workflow_instructions alone
- **WHEN** the given `columnId` does not exist in the template but `workflow_instructions` is set
- **THEN** `buildSystemInstructions()` returns `workflow_instructions` only (no crash)

---

### Requirement: getWorkflowTemplate correctly looks up templates from config
The system SHALL have unit tests verifying that `getWorkflowTemplate()` returns the correct template or null for all board/template combinations.

#### Scenario: Board found with known template
- **WHEN** a board row exists in the DB with a known `workflow_template_id`
- **THEN** `getWorkflowTemplate()` returns the matching `WorkflowTemplateConfig`

#### Scenario: Board not found — falls back to delivery template
- **WHEN** no board row exists for the given `boardId`
- **THEN** `getWorkflowTemplate()` falls back to the `"delivery"` template

#### Scenario: Board found with unknown template — returns null
- **WHEN** a board row exists but its `workflow_template_id` doesn't match any loaded workflow
- **THEN** `getWorkflowTemplate()` returns `null`

---

### Requirement: systemInstructions propagates correctly through all executor paths
The system SHALL have integration tests verifying that `systemInstructions` is assembled and passed to the engine for each of the four executor paths (transition, human-turn, retry, code-review).

#### Scenario: Transition executor delivers merged systemInstructions
- **WHEN** a task transitions into a column with both `workflow_instructions` and `stage_instructions` configured
- **THEN** the engine receives `ExecutionParams.systemInstructions` equal to the merged string

#### Scenario: Human-turn executor delivers merged systemInstructions
- **WHEN** a user sends a message to a task in a column with both fields configured
- **THEN** the engine receives the merged `systemInstructions`

#### Scenario: Workflow-only column delivers workflow_instructions alone
- **WHEN** a task is in a column with `workflow_instructions` set at template level but no `stage_instructions`
- **THEN** the engine receives `systemInstructions` equal to `workflow_instructions` only

#### Scenario: Stage-only column preserves existing behaviour
- **WHEN** the workflow template has no `workflow_instructions` but the column has `stage_instructions`
- **THEN** the engine receives `systemInstructions` equal to `stage_instructions` (no regression)

#### Scenario: Neither field means systemInstructions is undefined
- **WHEN** neither `workflow_instructions` nor `stage_instructions` is configured
- **THEN** the engine receives `systemInstructions` as `undefined`

#### Scenario: Multi-board isolation
- **WHEN** two boards use different workflow templates (one with `workflow_instructions`, one without)
- **THEN** each board's executions receive only the `systemInstructions` from their own template

---

### Requirement: systemInstructions reaches the Copilot SDK session config
The system SHALL have engine-level tests verifying that `systemInstructions` appears in the `systemMessage` passed to `MockCopilotSdkAdapter.createSession`.

#### Scenario: systemInstructions appears in createSession systemMessage
- **WHEN** `ExecutionParams.systemInstructions` is set to a known string
- **THEN** `MockCopilotSdkAdapter.trace.createCalls[0].config.systemMessage.content` contains that string

#### Scenario: No systemInstructions means no systemMessage key
- **WHEN** `ExecutionParams.systemInstructions` is `undefined`
- **THEN** the `systemMessage` key is absent from the `createSession` config

---

### Requirement: systemInstructions reaches the Claude SDK run config
The system SHALL have engine-level tests verifying that `systemInstructions` is captured in the extended `MockClaudeSdkAdapter` trace.

#### Scenario: systemInstructions captured in Claude mock trace
- **WHEN** `ExecutionParams.systemInstructions` is set to a known string
- **THEN** `MockClaudeSdkAdapter.trace.createCalls[0].systemInstructions` equals that string

#### Scenario: Undefined systemInstructions captured as absent in Claude trace
- **WHEN** `ExecutionParams.systemInstructions` is `undefined`
- **THEN** the `systemInstructions` field in the trace entry is `undefined` or absent
