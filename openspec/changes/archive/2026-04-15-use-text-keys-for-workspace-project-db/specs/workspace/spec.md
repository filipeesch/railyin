## MODIFIED Requirements

### Requirement: Workspace schema includes workspace_key for board and model association
The database schema SHALL store `workspace_key TEXT` (the file-derived string key, e.g. `"default"`) on `boards` and `enabled_models` instead of a hash-derived integer `workspace_id`. The key directly identifies the owning workspace without indirection.

#### Scenario: Board row carries workspace_key
- **WHEN** a board is created or queried
- **THEN** the `workspace_key` column contains the string key of the owning workspace (e.g. `"default"`)

#### Scenario: Enabled model row carries workspace_key
- **WHEN** model preferences are stored or queried for a workspace
- **THEN** the `workspace_key` column identifies the owning workspace

#### Scenario: No hash-derived integer needed
- **WHEN** the runtime resolves which workspace a board belongs to
- **THEN** it reads `workspace_key` directly without reversing a numeric hash

## REMOVED Requirements

### Requirement: Workspace schema includes workspace_id for future tenancy
**Reason**: Replaced by `workspace_key TEXT`. The hash-derived integer added indirection with no benefit after the FK mirror tables were removed.
**Migration**: Use `workspace_key` everywhere `workspace_id` was used.
