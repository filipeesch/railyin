## ADDED Requirements

### Requirement: Agent can list projects in current workspace
The system SHALL provide an AI tool (`list_projects`) that returns all configured projects in the current workspace, with full project data including paths, git root, and metadata. The workspace is determined from the execution context (chat session's `workspaceKey` or task's workspace).

#### Scenario: List projects from chat session context
- **WHEN** an agent in a chat session calls the `list_projects` tool
- **THEN** the tool returns all projects configured in the chat session's `workspaceKey` workspace, each with `key`, `name`, `workspaceKey`, `projectPath` (absolute and relative), `gitRootPath` (absolute and relative), `defaultBranch`, and optional `slug` and `description` fields

#### Scenario: List projects from task context
- **WHEN** an agent in a task execution calls the `list_projects` tool
- **THEN** the tool returns all projects configured in the task's workspace

#### Scenario: List projects when workspace has no projects
- **WHEN** an agent calls `list_projects` in a workspace with no configured projects
- **THEN** the tool returns an empty array

### Requirement: Agent can list workflows (boards) in current workspace
The system SHALL provide an AI tool (`list_workflows`) that returns all boards (runtime workflow instances) in the current workspace. Each board is identified by its `id` and `name`. The workspace is determined from the execution context.

#### Scenario: List workflows from chat session context
- **WHEN** an agent in a chat session calls the `list_workflows` tool
- **THEN** the tool returns all boards in the chat session's `workspaceKey` workspace, each with `id`, `name`, and `workspaceKey`

#### Scenario: List workflows from task context
- **WHEN** an agent in a task execution calls the `list_workflows` tool
- **THEN** the tool returns all boards in the task's workspace

#### Scenario: List workflows when workspace has no boards
- **WHEN** an agent calls `list_workflows` in a workspace with no boards
- **THEN** the tool returns an empty array
