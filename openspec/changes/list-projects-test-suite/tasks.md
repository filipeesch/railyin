## 1. Unit tests — list_projects registration and execution (common-tools-registration.test.ts)

- [ ] 1.1 Add `describe("list_projects tool registration")` block
- [ ] 1.2 LPT-R1: `list_projects` in `COMMON_TOOL_DEFINITIONS` (single entry)
- [ ] 1.3 LPT-R2: `list_projects` in `COMMON_TOOL_NAMES`
- [ ] 1.4 LPT-R3: `buildCommonToolDisplay("list_projects", {})` → `{ label: "list projects" }`
- [ ] 1.5 LPT-R4: Copilot engine registers `list_projects`
- [ ] 1.6 LPT-R5: Claude engine registers `list_projects`
- [ ] 1.7 Add `describe("list_projects execution")` block with mocked `repos.projects`
- [ ] 1.8 LPT-E1: Empty workspace → `"No projects configured in this workspace."`
- [ ] 1.9 LPT-E2: Single project → JSON with `detailedContent` + `data`
- [ ] 1.10 LPT-E3: Multiple projects → all in `data` array
- [ ] 1.11 LPT-E4: `detailedContent` uses relative paths only (no absolute paths)
- [ ] 1.12 LPT-E5: `data` includes all Project fields when set
- [ ] 1.13 LPT-E6: `data` omits optional fields when not set
- [ ] 1.14 LPT-E7: Workspace scoping — mock returns only projects for `ctx.workspaceKey`

## 2. Unit tests — workspace-tool-definitions module (common-tools-registration.test.ts)

- [ ] 2.1 LPT-M1: `WORKSPACE_TOOL_DEFINITIONS` exports exist (array, set, function)
- [ ] 2.2 LPT-M2: `WORKSPACE_TOOL_DEFINITIONS` contains `list_projects`
- [ ] 2.3 LPT-M3: `WORKSPACE_TOOL_NAMES` contains `list_projects`
- [ ] 2.4 LPT-M4: `buildWorkspaceToolDisplay("list_projects")` → `{ label: "list projects" }`

## 3. Unit tests — auto-derived names (common-tools-registration.test.ts)

- [ ] 3.1 LPT-AD1: `COMMON_TOOL_NAMES` matches `COMMON_TOOL_DEFINITIONS` (no extras, no missing)
- [ ] 3.2 LPT-AD2: `CHILD_COMMON_TOOL_NAMES` contains exactly 6 todo tool names
- [ ] 3.3 LPT-AD3: Todo tools have `childAllowed: true` in `COMMON_TOOL_DEFINITIONS`
- [ ] 3.4 LPT-AD4: Non-todo tools are NOT in `CHILD_COMMON_TOOL_NAMES`

## 4. Integration tests — real config (workspace-tools.test.ts, new file)

- [ ] 4.1 Create `src/bun/test/workspace-tools.test.ts`
- [ ] 4.2 LPT-I1: `executeCommonTool` with real config returns `test-project`
- [ ] 4.3 LPT-I2: Multiple projects via `extraYaml` are all returned
- [ ] 4.4 LPT-I3: Project with slug and description includes optional fields
- [ ] 4.5 LPT-I4: Project without optional fields omits slug/description

## 5. Update existing test files — add repos.projects mock

- [ ] 5.1 `common-tools-registration.test.ts`: add `repos.projects: { listByWorkspace: vi.fn(() => []) }` to `baseContext`
- [ ] 5.2 `note-tools.test.ts`: add `repos.projects` mock to `ctx`
- [ ] 5.3 `tasks-tools.test.ts`: add `repos.projects` mock to `commonCtx()`
- [ ] 5.4 `column-groups.test.ts`: add `repos.projects` mock to `makeCommonCtx()`
- [ ] 5.5 `pi-common-tools-bridge.test.ts`: add `repos.projects` mock to `makeCtx()`

## 6. Verification

- [ ] 6.1 `bun test src/bun --timeout 20000` — all tests pass
- [ ] 6.2 `bun test src/bun/test/workspace-tools.test.ts` — integration tests pass
- [ ] 6.3 No TypeScript errors in any test file
