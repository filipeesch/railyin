## ADDED Requirements

### Requirement: Fresh install seeds the workspace workflows directory from the bundled source
On startup the system SHALL seed the workspace workflows directory from the bundled workflows source directory. For every YAML file found in the bundled source directory, the system SHALL copy that file into the workspace workflows directory.

#### Scenario: All bundled workflow files are seeded
- **WHEN** a workspace is initialized and its workflows directory contains none of the bundled files
- **THEN** every YAML file from the bundled source directory is copied into the workspace workflows directory

#### Scenario: Workspace always has at least one workflow after seeding
- **WHEN** seeding completes
- **THEN** the workspace workflows directory contains at least one workflow file

### Requirement: User customizations are never overwritten
The system SHALL copy a bundled workflow file into the workspace workflows directory only when a file with that exact filename does not already exist there. Existing files SHALL be left untouched.

#### Scenario: Existing file with matching name is preserved
- **WHEN** the workspace workflows directory already contains a file whose name matches a bundled file
- **THEN** the bundled file is not copied and the existing file is left unchanged

#### Scenario: Only missing files are added
- **WHEN** the workspace workflows directory contains some but not all bundled files
- **THEN** only the bundled files whose filenames are absent are copied in

### Requirement: Bundled source resolves identically in development and production
The system SHALL resolve the bundled workflows source directory through a single resolution path used in both development and production. In development the resolution SHALL use the build-injected config directory constant; in production it SHALL resolve to the `config/workflows` directory packaged with the application. No workflow YAML content SHALL be hardcoded as string literals in runtime code for this resolution.

#### Scenario: Development resolves to the injected config directory
- **WHEN** the build-injected development config directory constant is defined and its workflows subdirectory exists
- **THEN** the bundled source directory resolves to that workflows subdirectory

#### Scenario: Production resolves to the packaged config directory
- **WHEN** the development constant is not available
- **THEN** the bundled source directory resolves to the `config/workflows` directory packaged with the application

### Requirement: Missing or empty bundled source falls back to a minimal delivery workflow
When the bundled source directory is missing or contains no YAML files, and the workspace workflows directory has no workflow files, the system SHALL write a minimal but valid delivery workflow as a last resort so the application always has at least one workflow.

#### Scenario: Fallback delivery workflow is written when source is missing
- **WHEN** the bundled source directory does not exist and the workspace has no workflow files
- **THEN** a minimal valid delivery workflow file is written to the workspace workflows directory

#### Scenario: Fallback delivery workflow is written when source is empty
- **WHEN** the bundled source directory exists but contains no YAML files and the workspace has no workflow files
- **THEN** a minimal valid delivery workflow file is written to the workspace workflows directory

### Requirement: The in-memory delivery fallback template is removed
The system SHALL NOT synthesize an in-memory workflow template that has no backing file. Every workflow returned by the configuration loader SHALL correspond to a real YAML file on disk.

#### Scenario: No phantom workflow appears in the loaded config
- **WHEN** the configuration is loaded and no workflow file has the id `delivery`
- **THEN** no `delivery` template is appended in memory and the loaded workflow list contains only file-backed workflows

#### Scenario: Every listed workflow is editable
- **WHEN** the configuration loader returns a workflow
- **THEN** that workflow has a resolvable YAML file and the YAML editor can load and save it
