## ADDED Requirements

### Requirement: Bundled-source resolution and file discovery are unit-tested
The test suite SHALL cover `getBundledWorkflowsDir`, `listWorkflowFiles`, `listBundledWorkflowIds`, and `resolveWorkflowFilePath` from the `src/bun/config/workflows.ts` module.

#### Scenario: getBundledWorkflowsDir resolves to an existing directory
- **WHEN** `getBundledWorkflowsDir()` is called in the test environment
- **THEN** it returns a directory path that exists and contains at least one workflow YAML file

#### Scenario: listWorkflowFiles returns id and name per file
- **WHEN** `listWorkflowFiles` runs against a directory of valid workflow YAML files
- **THEN** it returns one `{ id, name }` entry per file

#### Scenario: listWorkflowFiles skips unparseable files
- **WHEN** the directory contains a file with invalid YAML
- **THEN** that file is skipped and the remaining valid files are still returned

#### Scenario: resolveWorkflowFilePath matches by id when the filename differs
- **WHEN** a workflow file's name does not match its `id` field
- **THEN** `resolveWorkflowFilePath` still locates the file by scanning parsed `id` values, and returns `null` for an unknown id

#### Scenario: listBundledWorkflowIds returns the ids of the bundled source
- **WHEN** `listBundledWorkflowIds` runs against a configured bundled source directory
- **THEN** it returns the set of workflow ids in that directory, and an empty set when the directory is missing

### Requirement: seedWorkflows copy-if-absent and fallback branches are unit-tested
The test suite SHALL exercise `seedWorkflows(targetDir, sourceDir)` with an injected `sourceDir`, covering every copy and fallback branch.

#### Scenario: All bundled files are copied into an empty target
- **WHEN** `seedWorkflows` runs with a populated source and an empty target directory
- **THEN** every YAML file from the source is copied into the target

#### Scenario: Existing files are never overwritten
- **WHEN** the target already contains a file whose name matches a source file but with different content
- **THEN** `seedWorkflows` leaves that file's content unchanged and copies only the absent files

#### Scenario: Non-YAML files are ignored
- **WHEN** the source directory contains non-`.yaml`/`.yml` files
- **THEN** those files are not copied into the target

#### Scenario: Missing source writes the minimal delivery fallback
- **WHEN** the source directory does not exist and the target has no workflow files
- **THEN** a minimal valid delivery workflow file is written to the target

#### Scenario: Empty source writes the minimal delivery fallback
- **WHEN** the source directory exists but contains no YAML files and the target has no workflow files
- **THEN** a minimal valid delivery workflow file is written to the target

#### Scenario: No fallback is written when the target already has a workflow
- **WHEN** the source directory is missing or empty but the target already contains a workflow file
- **THEN** no fallback file is written and the existing workflow is left untouched

### Requirement: createWorkflowFile slug and collision behavior is unit-tested
The test suite SHALL cover `createWorkflowFile` id derivation, collision suffixing, the empty-slug fallback, and the shape of the written file.

#### Scenario: Name is slugified into the id and filename
- **WHEN** `createWorkflowFile` is called with a name containing spaces and mixed case
- **THEN** the id and filename are the lowercase dash-separated slug of that name

#### Scenario: Collisions append a numeric suffix
- **WHEN** `createWorkflowFile` is called twice with the same name
- **THEN** the second workflow's id receives a `-2` suffix, and a third receives `-3`

#### Scenario: Empty slug falls back to the default id
- **WHEN** the name contains no alphanumeric characters
- **THEN** the workflow id falls back to `workflow`, with numeric suffixing if `workflow` is taken

#### Scenario: The written file is valid and minimal
- **WHEN** a workflow is created
- **THEN** the written YAML parses successfully and contains the minimal three-column set with a backlog column marked `is_backlog`

### Requirement: evaluateDeletable guard outcomes are unit-tested
The test suite SHALL cover the pure `evaluateDeletable` function for every guard outcome.

#### Scenario: A free workflow is deletable
- **WHEN** a workflow has zero referencing boards and is not the only workflow
- **THEN** `evaluateDeletable` reports it as deletable

#### Scenario: A referenced workflow is not deletable
- **WHEN** a workflow is referenced by one or more boards
- **THEN** `evaluateDeletable` reports it as not deletable with a referenced-by-boards reason

#### Scenario: The last workflow is not deletable
- **WHEN** a workflow is the only one in the workspace
- **THEN** `evaluateDeletable` reports it as not deletable with a last-workflow reason

#### Scenario: Referenced reason wins when both guards apply
- **WHEN** a workflow is both referenced by a board and the only remaining workflow
- **THEN** `evaluateDeletable` reports the referenced-by-boards reason

#### Scenario: A bundled workflow is not deletable
- **WHEN** `evaluateDeletable` is called with the bundled flag set
- **THEN** it reports the workflow as not deletable with a bundled reason

#### Scenario: The bundled reason wins over the referenced and last reasons
- **WHEN** a workflow is bundled and also referenced by a board and the only one
- **THEN** `evaluateDeletable` reports the bundled reason

### Requirement: The no-phantom-delivery invariant is integration-tested
The test suite SHALL include a config-loader test proving the in-memory delivery fallback was removed.

#### Scenario: No phantom delivery template is appended
- **WHEN** the configuration is loaded from a workspace whose workflow files do not include an id of `delivery`
- **THEN** the loaded workflow list contains no `delivery` template and every loaded workflow has a resolvable backing file

#### Scenario: Seeding leaves the workspace with at least one workflow
- **WHEN** the configuration is loaded for a fresh workspace
- **THEN** the workspace workflows directory is populated and at least one workflow is loaded
