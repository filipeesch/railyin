## ADDED Requirements

### Requirement: QualifiedModelId encapsulates the engine-routable model ID format
The system SHALL provide a `QualifiedModelId` value object in `src/bun/engine/qualified-model-id.ts`. It SHALL parse the string format `{engineId}/{providerId?}/{modelId}`:
- 2-part string: `engineId` and `modelId`, no `providerId`
- 3-part string: `engineId`, `providerId`, and `modelId`

`QualifiedModelId.nativeModelId()` SHALL return the string the engine itself expects:
- For Copilot and Claude: `modelId` alone
- For OpenCode: `providerId/modelId`

`QualifiedModelId.toString()` SHALL return the full qualified string used for DB storage and display.

#### Scenario: Parse 2-part copilot model ID
- **WHEN** `QualifiedModelId.parse("copilot/gpt-4.1")` is called
- **THEN** `engineId` is `"copilot"`, `providerId` is `undefined`, `modelId` is `"gpt-4.1"`
- **AND** `nativeModelId()` returns `"gpt-4.1"`

#### Scenario: Parse 2-part claude model ID
- **WHEN** `QualifiedModelId.parse("claude/claude-sonnet-4-5")` is called
- **THEN** `engineId` is `"claude"`, `modelId` is `"claude-sonnet-4-5"`
- **AND** `nativeModelId()` returns `"claude-sonnet-4-5"`

#### Scenario: Parse 3-part opencode model ID
- **WHEN** `QualifiedModelId.parse("opencode/anthropic/claude-sonnet-4-5")` is called
- **THEN** `engineId` is `"opencode"`, `providerId` is `"anthropic"`, `modelId` is `"claude-sonnet-4-5"`
- **AND** `nativeModelId()` returns `"anthropic/claude-sonnet-4-5"`

#### Scenario: toString round-trips the original string
- **WHEN** `QualifiedModelId.parse(raw).toString()` is called
- **THEN** the result equals `raw` for any valid qualified ID string

#### Scenario: Invalid format throws
- **WHEN** `QualifiedModelId.parse("")` or `QualifiedModelId.parse("noSlash")` is called
- **THEN** an error is thrown describing the invalid format

### Requirement: All layers above the engine tier treat QualifiedModelId as opaque
Executors, orchestrator, model-resolver, and other callers above `EngineRegistry` SHALL NOT inspect `.engineId`, `.providerId`, or `.modelId` directly. They SHALL pass `QualifiedModelId` instances to registry methods and the registry SHALL perform all routing.

#### Scenario: Executor passes QualifiedModelId to registry without inspecting internals
- **WHEN** a transition executor resolves the model for an execution
- **THEN** it constructs a `QualifiedModelId` from the conversation model string and passes it to `getEngineForModel()` without branching on engine type
