## ADDED Requirements

### Requirement: Unit tests verify list_projects registration
The test suite SHALL verify that `list_projects` is registered in `COMMON_TOOL_DEFINITIONS`, `COMMON_TOOL_NAMES`, and across all engine implementations (Pi, Copilot, Claude).

#### Scenario: list_projects in COMMON_TOOL_DEFINITIONS
- **WHEN** `COMMON_TOOL_DEFINITIONS` is inspected in tests
- **THEN** it contains exactly one entry with `name: "list_projects"`

#### Scenario: list_projects in COMMON_TOOL_NAMES
- **WHEN** `COMMON_TOOL_NAMES.has("list_projects")` is called in tests
- **THEN** it returns `true`

#### Scenario: list_projects display label is correct
- **WHEN** `buildCommonToolDisplay("list_projects", {})` is called in tests
- **THEN** it returns `{ label: "list projects" }`

#### Scenario: Copilot engine registers list_projects
- **WHEN** `buildCopilotTools(ctx)` is called in tests
- **THEN** the returned tools include `list_projects`

#### Scenario: Claude engine registers list_projects
- **WHEN** `buildClaudeToolServer(sdk, z, ctx)` is called in tests
- **THEN** the registered tool names include `list_projects`

### Requirement: Unit tests verify list_projects execution with mocked repository
The test suite SHALL verify `executeCommonTool("list_projects", {}, ctx)` behavior using a mocked `ctx.repos.projects` (via `vi.fn()`). Tests SHALL cover empty workspace, single project, multiple projects, and field completeness.

#### Scenario: Empty workspace returns no projects message
- **WHEN** `ctx.repos.projects.listByWorkspace` is mocked to return `[]`
- **THEN** `executeCommonTool("list_projects", {}, ctx)` returns `{ type: "result", text: "No projects configured in this workspace." }`

#### Scenario: Single project returns JSON with detailedContent and data
- **WHEN** `ctx.repos.projects.listByWorkspace` is mocked to return a single Project
- **THEN** the result text is valid JSON with `detailedContent` (string) and `data` (array of 1 element)

#### Scenario: Multiple projects all appear in data array
- **WHEN** `ctx.repos.projects.listByWorkspace` is mocked to return 3 Projects
- **THEN** `data.length === 3` and all projects are present

#### Scenario: detailedContent uses relative paths only
- **WHEN** `ctx.repos.projects.listByWorkspace` is mocked to return a Project with absolute and relative paths
- **THEN** the `detailedContent` string contains the relative path values
- **AND** the `detailedContent` string does NOT contain the absolute path values

#### Scenario: data includes all Project fields when set
- **WHEN** `ctx.repos.projects.listByWorkspace` is mocked to return a Project with all fields (key, name, projectPath, gitRootPath, defaultBranch, slug, description)
- **THEN** `data[0]` contains all fields

#### Scenario: data omits optional fields when not set
- **WHEN** `ctx.repos.projects.listByWorkspace` is mocked to return a Project without `slug` and `description`
- **THEN** `data[0]` does NOT have `slug` or `description` properties

### Requirement: Integration tests verify list_projects with real config
The test suite SHALL verify `executeCommonTool("list_projects", {}, ctx)` using `setupTestConfig()` to create a real workspace.yaml and `ConfigProjectRepository` (not mocked). Tests SHALL cover workspace scoping, multiple projects, and optional fields.

#### Scenario: Real config returns projects from workspace.yaml
- **WHEN** `setupTestConfig()` creates a workspace with `test-project`
- **THEN** `executeCommonTool("list_projects", {}, ctx)` returns the project with `key: "test-project"`

#### Scenario: Multiple projects via extraYaml are all returned
- **WHEN** `setupTestConfig(extraYaml)` adds a second project
- **THEN** the result includes both projects

#### Scenario: Project with slug and description includes optional fields
- **WHEN** `setupTestConfig(extraYaml)` defines a project with `slug` and `description`
- **THEN** the returned Project includes `slug` and `description` in `data`
