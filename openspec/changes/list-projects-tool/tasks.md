## 1. Create project-repository.ts (DI layer)

- [ ] 1.1 Create `src/bun/db/project-repository.ts` with `IProjectRepository` interface (`listByWorkspace(workspaceKey: string): Project[]`)
- [ ] 1.2 Create `ConfigProjectRepository` class implementing `IProjectRepository` — wraps `listProjectsForWorkspace()`
- [ ] 1.3 Export `IProjectRepository` and `ConfigProjectRepository`

## 2. Create workspace-tool-definitions.ts (tool definition)

- [ ] 2.1 Create `src/bun/engine/workspace-tool-definitions.ts` with `WORKSPACE_TOOL_DEFINITIONS` array containing the `list_projects` tool definition (name, description, empty parameters)
- [ ] 2.2 Export `WORKSPACE_TOOL_NAMES` as `new Set(WORKSPACE_TOOL_DEFINITIONS.map(t => t.name))`
- [ ] 2.3 Export `buildWorkspaceToolDisplay(name, args)` function returning `{ label: "list projects" }` for `list_projects` and `null` for unknown names

## 3. Update AIToolDefinition + auto-derive CHILD_COMMON_TOOL_NAMES

- [ ] 3.1 Add `childAllowed?: boolean` to `AIToolDefinition` in `src/bun/ai/types.ts`
- [ ] 3.2 Mark 6 todo tools with `childAllowed: true` in `COMMON_TOOL_DEFINITIONS` (`create_todo`, `edit_todo`, `list_todos`, `get_todo`, `reorganize_todos`, `update_todo_status`)
- [ ] 3.3 Replace manual `CHILD_COMMON_TOOL_NAMES` in `src/bun/engine/pi/tools/index.ts` with auto-derived: `new Set(COMMON_TOOL_DEFINITIONS.filter(t => t.childAllowed).map(t => t.name))`

## 4. Update CommonToolContext + common-tools.ts

- [ ] 4.1 Add `repos.projects: IProjectRepository` to `CommonToolContext` in `src/bun/engine/types.ts`
- [ ] 4.2 Import `WORKSPACE_TOOL_DEFINITIONS`, `WORKSPACE_TOOL_NAMES`, `buildWorkspaceToolDisplay` from `./workspace-tool-definitions.ts`
- [ ] 4.3 Spread `...WORKSPACE_TOOL_DEFINITIONS` into `COMMON_TOOL_DEFINITIONS` after `...CARD_TOOL_DEFINITIONS` and before `DECISION_REQUEST_TOOL_DEFINITION`
- [ ] 4.4 Replace manual `COMMON_TOOL_NAMES` with auto-derived: `new Set(COMMON_TOOL_DEFINITIONS.map(t => t.name))`
- [ ] 4.5 Add `buildWorkspaceToolDisplay()` delegation in `buildCommonToolDisplay()` before the inline switch statement
- [ ] 4.6 Add `case "list_projects"` in `executeCommonToolText()` switch: call `ctx.repos.projects.listByWorkspace(ctx.workspaceKey)`, return `"No projects configured in this workspace."` if empty, otherwise return JSON with `detailedContent` (formatted markdown using relative paths) and `data` (raw Project array)

## 5. Update engine construction sites (inject ConfigProjectRepository)

- [ ] 5.1 Update `src/bun/engine/pi/engine.ts` — inject `new ConfigProjectRepository()` into `CommonToolContext.repos.projects`
- [ ] 5.2 Update `src/bun/engine/opencode/engine.ts` — inject `new ConfigProjectRepository()` into `CommonToolContext.repos.projects`

## 6. Update test files (add projects mock to CommonToolContext)

- [ ] 6.1 Update `src/bun/test/common-tools-registration.test.ts` — add `repos.projects` mock to `baseContext`
- [ ] 6.2 Update `src/bun/test/note-tools.test.ts` — add `repos.projects` mock
- [ ] 6.3 Update `src/bun/test/tasks-tools.test.ts` — add `repos.projects` mock
- [ ] 6.4 Update `src/bun/test/column-groups.test.ts` — add `repos.projects` mock
- [ ] 6.5 Update `src/bun/test/pi-common-tools-bridge.test.ts` — add `repos.projects` mock

## 7. Verification

- [ ] 7.1 Run `bun test src/bun --timeout 20000` to confirm no regressions
- [ ] 7.2 Verify `list_projects` appears in `COMMON_TOOL_DEFINITIONS` and `COMMON_TOOL_NAMES`
- [ ] 7.3 Verify `buildCommonToolDisplay("list_projects", {})` returns `{ label: "list projects" }`
- [ ] 7.4 Verify `CHILD_COMMON_TOOL_NAMES` contains exactly 6 todo tool names
- [ ] 7.5 Verify `COMMON_TOOL_NAMES` is auto-derived (no manual names)
