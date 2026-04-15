## MODIFIED Requirements

### Requirement: Copilot engine lists models available through GitHub Copilot
The `CopilotEngine.listModels()` method SHALL return the list of models available through the user's Copilot subscription. For Copilot model selection, the returned list SHALL prepend a synthetic `Auto` entry at index 0. The `Auto` entry SHALL use null model identity (`qualifiedId: null`) and SHALL include a description indicating that Copilot chooses the best available model based on task context, availability, and subscription access. If the SDK provides a model listing API, it SHALL be used for concrete models.

#### Scenario: Models returned from Copilot engine
- **WHEN** `listModels()` is called on the Copilot engine
- **THEN** it returns an array of `EngineModelInfo` with at least one model entry

#### Scenario: Auto entry is first and nullable
- **WHEN** `listModels()` returns results for Copilot
- **THEN** entry index 0 is `Auto`
- **AND** the entry has `qualifiedId = null`
- **AND** concrete models continue to use `qualifiedId` values prefixed with `copilot/`

#### Scenario: Auto entry includes behavior description
- **WHEN** `listModels()` returns the synthetic `Auto` entry
- **THEN** the entry includes description text explaining Copilot-managed model selection behavior

#### Scenario: Concrete model list includes model ID and display name
- **WHEN** `listModels()` returns concrete Copilot model results
- **THEN** each concrete entry includes at minimum a model-qualified ID and display name
