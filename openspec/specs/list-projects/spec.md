## Purpose

The `list_projects` tool enables the AI model to discover all projects registered in the current workspace, returning project metadata including key, name, path, git repository, default branch, slug, and description.

## Requirements

### Requirement: list_projects returns workspace-scoped project list
The system SHALL expose a `list_projects` common tool that returns all projects belonging to the current workspace (`ctx.workspaceKey`). The tool SHALL require no arguments. It SHALL return a JSON string containing `detailedContent` (human-readable formatted text) and `data` (array of raw Project objects). The `detailedContent` SHALL include only workspace-relative paths (`projectPath.relative`, `gitRootPath.relative`).

#### Scenario: list_projects returns projects for the context workspace
- **WHEN** `executeCommonTool("list_projects", {}, ctx)` is called with `ctx.workspaceKey = "default"`
- **THEN** the result contains all projects where `workspaceKey === "default"`

#### Scenario: list_projects includes all project fields in data
- **WHEN** `executeCommonTool("list_projects", {}, ctx)` is called
- **THEN** the `data` array contains Project objects with `key`, `name`, `projectPath` (absolute + relative), `gitRootPath` (absolute + relative), `defaultBranch`, `slug` (if set), and `description` (if set)

#### Scenario: detailedContent uses relative paths only
- **WHEN** `executeCommonTool("list_projects", {}, ctx)` is called
- **THEN** the `detailedContent` string contains only workspace-relative paths (no host filesystem paths)

### Requirement: list_projects returns clear message for empty workspace
When the workspace has no projects configured, the tool SHALL return a plain text message: `"No projects configured in this workspace."`

#### Scenario: Empty workspace returns no projects message
- **WHEN** `executeCommonTool("list_projects", {}, ctx)` is called and the workspace has zero projects
- **THEN** the result text equals `"No projects configured in this workspace."`

### Requirement: list_projects is registered in COMMON_TOOL_DEFINITIONS
The `COMMON_TOOL_DEFINITIONS` array SHALL include the `list_projects` tool definition with an empty `parameters` object (no required or optional parameters). The tool SHALL be placed after card tools and before decision tools.

#### Scenario: list_projects appears in COMMON_TOOL_DEFINITIONS
- **WHEN** an engine iterates over `COMMON_TOOL_DEFINITIONS`
- **THEN** `list_projects` is present with `name: "list_projects"` and `parameters: { type: "object", properties: {}, required: [] }`

### Requirement: list_projects is included in COMMON_TOOL_NAMES
The `COMMON_TOOL_NAMES` set SHALL include `"list_projects"` so that display builders and engine adapters recognise it as a common tool.

#### Scenario: list_projects is in COMMON_TOOL_NAMES
- **WHEN** `COMMON_TOOL_NAMES.has("list_projects")` is checked
- **THEN** it returns `true`

### Requirement: list_projects display label is "list projects"
The `buildCommonToolDisplay` function SHALL return `{ label: "list projects" }` for the `list_projects` tool name.

#### Scenario: list_projects display label
- **WHEN** `buildCommonToolDisplay("list_projects", {})` is called
- **THEN** it returns `{ label: "list projects" }`

### Requirement: list_projects works across all engines
The `list_projects` tool SHALL be registered and available in all engine implementations (Pi, Copilot, Claude) through the `COMMON_TOOL_DEFINITIONS` array.

#### Scenario: list_projects available in Pi engine
- **WHEN** the Pi engine registers common tools
- **THEN** `list_projects` is included in the tool list

#### Scenario: list_projects available in Copilot engine
- **WHEN** the Copilot engine builds mapped common tools
- **THEN** `list_projects` is included in the tool list

#### Scenario: list_projects available in Claude engine
- **WHEN** the Claude engine builds the shared tool server
- **THEN** `list_projects` is registered with the SDK

### Requirement: list_projects tool definition is extracted to workspace-tool-definitions.ts
The `list_projects` tool definition, names set, and display builder SHALL be extracted into `src/bun/engine/workspace-tool-definitions.ts`, following the `card-tool-definitions.ts` pattern. The file SHALL export `WORKSPACE_TOOL_DEFINITIONS`, `WORKSPACE_TOOL_NAMES`, and `buildWorkspaceToolDisplay`.

#### Scenario: workspace-tool-definitions.ts exports required symbols
- **WHEN** `common-tools.ts` imports from `./workspace-tool-definitions.ts`
- **THEN** `WORKSPACE_TOOL_DEFINITIONS` (array), `WORKSPACE_TOOL_NAMES` (set), and `buildWorkspaceToolDisplay` (function) are available

#### Scenario: WORKSPACE_TOOL_DEFINITIONS includes list_projects
- **WHEN** `WORKSPACE_TOOL_DEFINITIONS` is inspected
- **THEN** it contains exactly one tool with `name: "list_projects"`
