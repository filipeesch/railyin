## ADDED Requirements

### Requirement: stream() uses configured effort as default for parent agent calls
The system SHALL apply `anthropic.effort` from workspace config to `stream()` calls when no explicit `effort` is provided in `AICallOptions`. When `AICallOptions.effort` is explicitly set (e.g. sub-agents passing `"low"`), it SHALL take precedence over the config value.

#### Scenario: Config effort applied when no explicit effort given
- **WHEN** `anthropic.effort` is `"medium"` in workspace config AND `stream()` is called without an `effort` field in `AICallOptions`
- **THEN** the Anthropic request body includes `output_config: { effort: "medium" }`

#### Scenario: Explicit AICallOptions effort overrides config
- **WHEN** `anthropic.effort` is `"medium"` in workspace config AND `stream()` is called with `effort: "low"` in `AICallOptions`
- **THEN** the Anthropic request body includes `output_config: { effort: "low" }`

#### Scenario: No effort in config and no explicit effort — omit output_config
- **WHEN** `anthropic.effort` is absent from workspace config AND `stream()` is called without `effort` in `AICallOptions`
- **THEN** the Anthropic request body does NOT include an `output_config` field
