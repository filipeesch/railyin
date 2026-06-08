## ADDED Requirements

### Requirement: COMMON_TOOL_DEFINITIONS includes list_projects
The `COMMON_TOOL_DEFINITIONS` array SHALL include the `list_projects` tool definition, imported from the `workspace-tool-definitions.ts` module via spread (`...WORKSPACE_TOOL_DEFINITIONS`). The definition SHALL be positioned after card tools and before decision tools.

#### Scenario: list_projects appears in COMMON_TOOL_DEFINITIONS
- **WHEN** `COMMON_TOOL_DEFINITIONS` is inspected
- **THEN** it contains an entry with `name: "list_projects"`
- **AND** the entry appears after card tool definitions and before `DECISION_REQUEST_TOOL_DEFINITION`

### Requirement: COMMON_TOOL_NAMES is auto-derived from COMMON_TOOL_DEFINITIONS
The `COMMON_TOOL_NAMES` set SHALL be auto-derived from `COMMON_TOOL_DEFINITIONS` via `new Set(COMMON_TOOL_DEFINITIONS.map(t => t.name))`. The manual list of tool names SHALL be removed. Every tool in `COMMON_TOOL_DEFINITIONS` SHALL automatically appear in `COMMON_TOOL_NAMES` without explicit enumeration.

#### Scenario: Adding a tool to definitions auto-adds it to names
- **WHEN** a new tool definition is added to `COMMON_TOOL_DEFINITIONS`
- **THEN** `COMMON_TOOL_NAMES.has(newToolName)` returns `true` without any manual update

#### Scenario: list_projects is in COMMON_TOOL_NAMES
- **WHEN** `COMMON_TOOL_NAMES.has("list_projects")` is called
- **THEN** it returns `true`

### Requirement: executeCommonToolText handles list_projects via injected repository
The `executeCommonToolText` switch in `common-tools.ts` SHALL include a `case "list_projects"` that calls `ctx.repos.projects.listByWorkspace(ctx.workspaceKey)` and returns the formatted response or empty-workspace message. The handler SHALL use the injected `IProjectRepository` from `CommonToolContext.repos` — NOT call `listProjectsForWorkspace()` directly.

#### Scenario: executeCommonTool handles list_projects via DI
- **WHEN** `executeCommonToolText("list_projects", {}, ctx)` is called with a mocked `ctx.repos.projects`
- **THEN** it calls `ctx.repos.projects.listByWorkspace(ctx.workspaceKey)` and returns the formatted response

#### Scenario: Empty workspace returns no projects message
- **WHEN** `ctx.repos.projects.listByWorkspace()` returns an empty array
- **THEN** the handler returns `"No projects configured in this workspace."`

### Requirement: CommonToolContext.repos includes IProjectRepository
`CommonToolContext` (in `src/bun/engine/types.ts`) SHALL include a `repos.projects: IProjectRepository` field. The `IProjectRepository` interface SHALL declare `listByWorkspace(workspaceKey: string): Project[]`. Production code SHALL inject `ConfigProjectRepository` which wraps `listProjectsForWorkspace()`.

#### Scenario: CommonToolContext requires projects repo
- **WHEN** code constructs a `CommonToolContext` object
- **THEN** TypeScript requires a `repos.projects` field of type `IProjectRepository`

#### Scenario: Pi engine injects ConfigProjectRepository
- **WHEN** `PiEngine` builds a `CommonToolContext` for execution
- **THEN** it passes `new ConfigProjectRepository()` as the `repos.projects` field

#### Scenario: OpenCode engine injects ConfigProjectRepository
- **WHEN** `OpenCodeEngine` builds a `CommonToolContext` for execution
- **THEN** it passes `new ConfigProjectRepository()` as the `repos.projects` field

### Requirement: buildCommonToolDisplay delegates workspace tool display
The `buildCommonToolDisplay` function SHALL call `buildWorkspaceToolDisplay(name, args)` (imported from `workspace-tool-definitions.ts`) before falling through to the inline switch. The workspace tool display builder SHALL return `{ label: "list projects" }` for `list_projects`.

#### Scenario: Workspace tool display is delegated
- **WHEN** `buildCommonToolDisplay("list_projects", {})` is called
- **THEN** it returns `{ label: "list projects" }` via the `buildWorkspaceToolDisplay` delegate

### Requirement: AIToolDefinition includes childAllowed flag
The `AIToolDefinition` interface (in `src/bun/ai/types.ts`) SHALL include an optional `childAllowed?: boolean` field. When `true`, the tool is allowed in child (subagent) sessions. The `CHILD_COMMON_TOOL_NAMES` set in `src/bun/engine/pi/tools/index.ts` SHALL be auto-derived from `COMMON_TOOL_DEFINITIONS` by filtering for `childAllowed === true`.

#### Scenario: childAllowed flag auto-derives CHILD_COMMON_TOOL_NAMES
- **WHEN** `CHILD_COMMON_TOOL_NAMES` is inspected
- **THEN** it contains exactly the names of tools in `COMMON_TOOL_DEFINITIONS` where `childAllowed === true`

#### Scenario: Todo tools have childAllowed true
- **WHEN** `COMMON_TOOL_DEFINITIONS` is inspected for todo tools
- **THEN** `create_todo`, `edit_todo`, `list_todos`, `get_todo`, `reorganize_todos`, and `update_todo_status` have `childAllowed: true`

#### Scenario: Non-todo tools do not have childAllowed
- **WHEN** `COMMON_TOOL_DEFINITIONS` is inspected for non-todo tools (e.g. `list_projects`, `decision_request`)
- **THEN** `childAllowed` is `undefined` or `false`
- **AND** these tools are NOT in `CHILD_COMMON_TOOL_NAMES`

#### Scenario: Adding childAllowed to a tool auto-adds it to CHILD_COMMON_TOOL_NAMES
- **WHEN** a tool definition in `COMMON_TOOL_DEFINITIONS` is updated to include `childAllowed: true`
- **THEN** `CHILD_COMMON_TOOL_NAMES.has(toolName)` returns `true` without manual update

## REMOVED Requirements

### Requirement: Manual COMMON_TOOL_NAMES enumeration (deprecated)
The manual enumeration of tool names in `COMMON_TOOL_NAMES` is deprecated and SHALL be replaced with auto-derivation.

**Reason**: Manual name maintenance is a known source of bugs — every tool addition requires updating two places (definitions + names). Auto-derivation eliminates this fragility with a single line of code.

**Migration**: Replace `export const COMMON_TOOL_NAMES = new Set([...CARD_TOOL_NAMES, "decision_request", ...])` with `export const COMMON_TOOL_NAMES = new Set(COMMON_TOOL_DEFINITIONS.map(t => t.name))`. The result is identical since `COMMON_TOOL_DEFINITIONS` already includes all tool definitions via spreads.

### Requirement: Manual CHILD_COMMON_TOOL_NAMES enumeration (deprecated)
The manual enumeration of tool names in `CHILD_COMMON_TOOL_NAMES` is deprecated and SHALL be replaced with auto-derivation from the `childAllowed` flag.

**Reason**: Manual name maintenance is fragile — adding a todo tool requires updating both the definition and the child names set. Auto-derivation via `childAllowed` flag eliminates this duplication.

**Migration**: Replace `export const CHILD_COMMON_TOOL_NAMES = new Set<string>(["create_todo", ...])` with `export const CHILD_COMMON_TOOL_NAMES = new Set(COMMON_TOOL_DEFINITIONS.filter(t => t.childAllowed).map(t => t.name))`. Mark the 6 todo tools with `childAllowed: true` in their definitions.
