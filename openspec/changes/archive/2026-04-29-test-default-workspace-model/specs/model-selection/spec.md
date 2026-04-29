## ADDED Requirements

### Requirement: resolveTaskModel treats empty string as not-set
The `resolveTaskModel()` function SHALL use `||` (not `??`) so that empty string values fall through to the next source in the priority chain. An empty string for `columnModel` or `taskModel` SHALL be treated equivalently to `null` or `undefined`.

#### Scenario: Empty column model falls through to task model
- **WHEN** `columnModel` is `""` (empty string) and `taskModel` is `"gpt-4.1"`
- **THEN** `resolveTaskModel` returns `"gpt-4.1"`

#### Scenario: Empty task model falls through to engine model
- **WHEN** `columnModel` is null, `taskModel` is `""` (empty string), and `engineConfig.model` is `"gpt-4.1"`
- **THEN** `resolveTaskModel` returns `"gpt-4.1"`

#### Scenario: resolveTaskModel returns empty string when all sources are empty or absent
- **WHEN** `columnModel` is `""`, `taskModel` is `""`, and `engineConfig` has no `model` property
- **THEN** `resolveTaskModel` returns `""`

### Requirement: HumanTurnExecutor resolves engine.model on the engine-lost fallback path
The system SHALL apply `resolveTaskModel()` on the `HumanTurnExecutor` waiting_user engine-lost fallback path (when `engine.resume()` throws). The resolved model SHALL be written back to the database and used in the fresh execution params, identical to the normal execution path.

#### Scenario: Engine-lost fallback resolves engine.model when task model is null
- **WHEN** a `HumanTurnExecutor` execution is started for a task with `model = null`, `engine.resume()` throws (session lost), and `engine.model` is configured
- **THEN** the fallback fresh execution uses `engine.model` as the model
- **AND** `task.model` is updated in the database with the resolved value

### Requirement: setupTestConfig supports configuring absence of engine.model
The test helper `setupTestConfig` SHALL accept an `engineModel` option that, when set to `null`, produces a workspace config without any `model:` line under the `engine:` block. All existing callers that do not pass this option SHALL see no behavior change.

#### Scenario: engineModel null omits model from config
- **WHEN** `setupTestConfig` is called with `engineModel: null`
- **THEN** the generated `workspace.test.yaml` has no `model:` field under `engine:`
- **AND** tasks created in that config have `model = NULL` in the database

#### Scenario: Default engineModel preserved for existing tests
- **WHEN** `setupTestConfig` is called without `engineModel` option
- **THEN** the generated config contains `model: copilot/mock-model` as before
