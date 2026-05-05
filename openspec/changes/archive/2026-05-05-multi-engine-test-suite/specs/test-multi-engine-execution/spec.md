## ADDED Requirements

### Requirement: ME-engine-routing
Executions are dispatched to the engine matching the conversation's `QualifiedModelId`.

#### Scenario: ME-1 copilot model executes via copilot engine
- **WHEN** conversation model is `"copilot/gpt-4.1"` and a message is sent
- **THEN** the copilot mock engine receives the execution call; claude mock does not

#### Scenario: ME-2 claude model executes via claude engine
- **WHEN** conversation model is `"claude/claude-sonnet"` and a message is sent
- **THEN** the claude mock engine receives the execution call; copilot mock does not

#### Scenario: ME-3 opencode 3-part model executes via opencode engine
- **WHEN** conversation model is `"opencode/anthropic/claude-sonnet-4-5"` and a message is sent
- **THEN** the opencode mock engine receives the execution call

#### Scenario: ME-4 two tasks with different engines execute independently
- **WHEN** task A has a copilot model and task B has a claude model, both send messages
- **THEN** each task's execution is routed to the correct engine independently

---

### Requirement: ME-model-seeding
New tasks with no model set inherit the default engine's default model.

#### Scenario: ME-5 null model seeded from engines[0] default model
- **WHEN** a new task is created with no model and `engines.yaml` defines copilot as first entry with `model: gpt-4.1`
- **THEN** `conversations.model` is set to `"copilot/gpt-4.1"` on first execution

---

### Requirement: ME-list-models
`listModels()` on the orchestrator aggregates models from all allowed engines.

#### Scenario: ME-6 listModels returns models from both engines
- **WHEN** registry has copilot (2 models) and claude (1 model) and `listModels(workspaceKey)` is called
- **THEN** response contains all 3 models with correct `id` fields using qualified format

#### Scenario: ME-7 listModels respects allowed_engines filter
- **WHEN** workspace `allowed_engines: [copilot]` and `listModels(workspaceKey)` is called
- **THEN** only copilot models are returned; claude models are absent

#### Scenario: ME-8 column transition seeds model from default engine
- **WHEN** a task transitions to a column with `on_enter_prompt` and has no model
- **THEN** the seeded model uses the default engine's qualified model ID format
