## MODIFIED Requirements

### Requirement: Workspace configuration supports optional allowed_engines filter
The workspace YAML schema SHALL support an optional `allowed_engines` field containing a list of engine IDs. When present, only the listed engines (as declared in `engines.yaml`) SHALL be available for that workspace. When absent, all engines are available. The existing `engine:` block SHALL remain valid for backward compatibility but SHALL be superseded by `engines.yaml` when that file is present.

#### Scenario: allowed_engines restricts model picker
- **WHEN** a workspace declares `allowed_engines: [copilot]`
- **THEN** only copilot models appear in that workspace's model picker

#### Scenario: No allowed_engines means all engines available
- **WHEN** a workspace has no `allowed_engines` field
- **THEN** all engines from `engines.yaml` are available in that workspace

#### Scenario: engine: block in workspace.yaml ignored when engines.yaml present
- **WHEN** `config/engines.yaml` exists AND `workspace.yaml` has an `engine:` block
- **THEN** the `engine:` block is ignored and a startup notice is logged

#### Scenario: engine: block used as fallback when engines.yaml absent
- **WHEN** `config/engines.yaml` does NOT exist AND `workspace.yaml` has `engine: { type: claude }`
- **THEN** ClaudeEngine is the only available engine for all workspaces, matching current behavior
