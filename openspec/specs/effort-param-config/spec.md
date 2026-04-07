## ADDED Requirements

### Requirement: Workspace config supports anthropic.effort option
The system SHALL accept an optional `effort` field under `anthropic` in `workspace.yaml`. Valid values are `"low"`, `"medium"`, `"high"`, and `"max"`. When absent, no effort is specified and the provider default applies (Sonnet 4.6 defaults to `high`).

#### Scenario: Valid effort value accepted
- **WHEN** `workspace.yaml` contains `anthropic: { effort: "medium" }`
- **THEN** the config is parsed without error and `config.workspace.anthropic.effort === "medium"`

#### Scenario: Absent effort field leaves option unset
- **WHEN** `workspace.yaml` does not contain `anthropic.effort`
- **THEN** `config.workspace.anthropic.effort` is `undefined`
