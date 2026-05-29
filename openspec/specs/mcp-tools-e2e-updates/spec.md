# mcp-tools-e2e-updates Specification

## Purpose
TBD - created by archiving change mcp-disabled-by-default-tests. Update Purpose after archive.
## Requirements
### Requirement: mock-data.ts defaults reflect new disabled-by-default semantics
The test fixture helpers SHALL use `enabledMcpTools: []` as the default in `makeTask()` and `makeChatSession()`, matching the new production default.

#### Scenario: makeTask default is empty array
- **WHEN** `makeTask()` is called without specifying `enabledMcpTools`
- **THEN** the returned task SHALL have `enabledMcpTools: []`

#### Scenario: makeChatSession default is empty array
- **WHEN** `makeChatSession()` is called without specifying `enabledMcpTools`
- **THEN** the returned session SHALL have `enabledMcpTools: []`

### Requirement: Existing Playwright tests updated for new null semantics
Tests V-12, V-24, and V-25 in `mcp-tools.spec.ts` SHALL be updated to reflect that `null` / `[]` means all tools unchecked.

#### Scenario: V-12 updated — empty array means all unchecked
- **WHEN** a task has `enabledMcpTools: []`
- **THEN** all server-level and tool-level checkboxes in the MCP tools popover SHALL be unchecked

#### Scenario: V-24/V-25 updated — toggling never produces null
- **WHEN** the user toggles all tools on or off
- **THEN** the API call SHALL use an explicit array (full list or `[]`), never `null`

### Requirement: Default disabled state is verified by new Playwright suite
A new suite (B) SHALL verify that the MCP tools popover renders all tools unchecked for tasks that have `enabledMcpTools: []`.

#### Scenario: B-1 — all server checkboxes unchecked by default
- **WHEN** a task with `enabledMcpTools: []` opens the MCP tools popover
- **THEN** all server-level checkboxes SHALL be unchecked

#### Scenario: B-2 — individual tool rows unchecked by default
- **WHEN** a task with `enabledMcpTools: []` opens the MCP tools popover
- **THEN** all individual tool rows SHALL be unchecked

#### Scenario: B-3 — specific tool enabled appears checked
- **WHEN** a task with `enabledMcpTools: ["server1:tool1"]` opens the popover
- **THEN** only the `server1:tool1` row SHALL be checked; all others SHALL be unchecked

#### Scenario: B-4 — server checkbox is indeterminate when only some tools selected
- **WHEN** a task has some but not all tools of a server enabled
- **THEN** that server's checkbox SHALL be in indeterminate state

### Requirement: Two edit buttons visible in task chat context
A new suite (C) SHALL verify that both "Edit global config" and "Edit project config" buttons appear in the MCP tools popover for task chat windows.

#### Scenario: C-1 — task chat shows both edit buttons
- **WHEN** the MCP tools popover opens in a task chat window with a project_key
- **THEN** both "Edit global mcp.json" and "Edit project mcp.json" buttons SHALL be visible

#### Scenario: C-2 — clicking "Edit global config" uses global RPC
- **WHEN** the user clicks "Edit global mcp.json"
- **THEN** `mcp.getConfig` SHALL be called and the editor SHALL show the global file path

#### Scenario: C-3 — clicking "Edit project config" uses project RPC
- **WHEN** the user clicks "Edit project mcp.json"
- **THEN** `mcp.getProjectConfig` SHALL be called with the task's workspaceKey and projectKey

#### Scenario: C-4 — saving project config calls mcp.saveProjectConfig
- **WHEN** the user saves from the project config editor
- **THEN** `mcp.saveProjectConfig` SHALL be called with the updated content

### Requirement: Session chat hides project edit button
A new suite (D) SHALL verify that the "Edit project mcp.json" button is absent in session chat context.

#### Scenario: D-1 — session chat shows only global edit button
- **WHEN** the MCP tools popover opens in a session chat window (no project_key)
- **THEN** only "Edit global mcp.json" SHALL be visible; "Edit project mcp.json" SHALL NOT be present in the DOM

#### Scenario: D-2 — session global edit button still works
- **WHEN** the user clicks "Edit global mcp.json" in a session chat
- **THEN** `mcp.getConfig` SHALL be called and the editor SHALL open normally

