## ADDED Requirements

### Requirement: Standalone session chat resolves workspace root for execution and discovery
The system SHALL resolve a standalone session's working directory and editor discovery scope from the active workspace configuration.

#### Scenario: Session execution uses workspace root
- **WHEN** a standalone session execution is started and the active workspace has `workspace_path` configured
- **THEN** the execution runs with that workspace path as its working directory

#### Scenario: Session execution falls back compatibly when workspace root missing
- **WHEN** a standalone session execution is started and the active workspace has no configured `workspace_path`
- **THEN** the system uses the existing compatible fallback path instead of failing the session turn

