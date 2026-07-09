## ADDED Requirements

### Requirement: ModelSettingAxis SHALL be the normalized unit for any engine-exposed model parameter
The system SHALL define a `ModelSettingAxis` type that represents a single configurable parameter axis: a stable `id`, a `label` (for display), an `options[]` array of `{value, label}` pairs, a `defaultValue`, and a `visible` flag. `ModelSettingsInfo` SHALL expose `settings: ModelSettingAxis[]`. An empty array means the model has no configurable settings and the UI SHALL hide any settings selector.

#### Scenario: Claude model with effort support returns a synthesized axis
- **WHEN** `models.listEnabled` is called for a Claude model with `supportedEffortLevels: ["low","medium","high","max"]`
- **THEN** the response includes `settings: [{ id: "effort", label: "Effort", options: [{value:"low",label:"Low"},…], defaultValue: null, visible: true }]`

#### Scenario: Copilot model with reasoning effort returns a synthesized axis with default
- **WHEN** `models.listEnabled` is called for a Copilot model with `supportedReasoningEfforts` and `defaultReasoningEffort: "medium"`
- **THEN** the response includes `settings: [{ id: "reasoningEffort", label: "Reasoning Effort", options: […], defaultValue: "medium", visible: true }]`

#### Scenario: Cursor model with parameters returns one axis per parameter
- **WHEN** `models.listEnabled` is called for a Cursor model with `parameters: [{id:"fast_apply", displayName:"Speed", values:[{value:"fast",displayName:"Fast"},{value:"normal",displayName:"Normal"}]}]`
- **THEN** the response includes `settings: [{ id: "fast_apply", label: "Speed", options: [{value:"fast",label:"Fast"},{value:"normal",label:"Normal"}], visible: true }]`

#### Scenario: Cursor model with only variants returns a synthesized variant axis
- **WHEN** `models.listEnabled` is called for a Cursor model that has no `parameters[]` but has `variants: [{displayName:"Fast",params:[…],isDefault:true},{displayName:"Normal",params:[…]}]`
- **THEN** the response includes `settings: [{ id: "variant", label: "Mode", options: [{value:"Fast",label:"Fast"},{value:"Normal",label:"Normal"}], defaultValue: "Fast", visible: true }]`

#### Scenario: Model with no settings returns empty settings array
- **WHEN** `models.listEnabled` is called for a model with no SDK-exposed parameters
- **THEN** the response includes `settings: []`
- **AND** UI hides any settings selector

### Requirement: `model_params` JSON column SHALL persist user-selected parameter values per conversation
The system SHALL store per-conversation model parameter overrides in a `model_params JSON` column on the `conversations` table. The value is an array of `{id: string, value: string}` objects. Null or empty array means no overrides are active. This column replaces the previous `reasoning_mode_override TEXT` column.

#### Scenario: User sets effort value — stored as model_params
- **WHEN** the user selects effort "high" for a model with axis id "effort"
- **THEN** `conversations.model_params` is updated to `[{"id":"effort","value":"high"}]`

#### Scenario: Model switch clears incompatible params and applies new model's defaults
- **WHEN** the user switches to a model that does not have an axis matching the current `model_params` entries
- **THEN** incompatible entries are removed from `model_params`
- **AND** if the new model exposes a default value for a setting axis, that default is stored as the new `model_params` value

### Requirement: `modelParams` SHALL be passed through `ExecutionParams` to engine `execute()`
The system SHALL inject the conversation's `model_params` into `ExecutionParams.modelParams` via `ExecutionParamsEnricher`. Each engine adapter SHALL read this field and apply it to the SDK call: Claude maps `{id:"effort"}` → `effort` field; Copilot maps `{id:"reasoningEffort"}` → `reasoningEffort` field; Cursor passes the array directly as `ModelSelection.params`.

#### Scenario: User-selected effort is applied to Claude SDK call
- **WHEN** a conversation has `model_params = [{"id":"effort","value":"high"}]` and Claude engine executes
- **THEN** the SDK call includes `effort: "high"`

#### Scenario: User-selected reasoning effort is applied to Copilot SDK call
- **WHEN** a conversation has `model_params = [{"id":"reasoningEffort","value":"medium"}]` and Copilot engine executes
- **THEN** the SDK session config includes `reasoningEffort: "medium"`

#### Scenario: Cursor params are passed directly to ModelSelection
- **WHEN** a conversation has `model_params = [{"id":"fast_apply","value":"fast"}]` and Cursor engine executes
- **THEN** the model selection object sent to the Cursor SDK includes `params: [{"id":"fast_apply","value":"fast"}]`

#### Scenario: No model_params means no override — engine uses its default
- **WHEN** a conversation has `model_params = null` or `[]`
- **THEN** the engine does not set any effort or params override in the SDK call
