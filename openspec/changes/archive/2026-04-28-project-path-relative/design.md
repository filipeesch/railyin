## Context

Project paths in `workspace.yaml` are currently stored as absolute paths (e.g. `/home/alice/repos/myapp`). This makes configs non-portable and tightly coupled to a single machine. The system already has a `workspace_path` field that is optional today but is used as a CWD fallback in four separate places via the inline pattern `config.workspace.workspace_path ?? config.configDir`. The `WorkingDirectoryResolver` computes `relative(gitRootPath, projectPath)` at runtime on every worktree CWD call. Path writes from the project-store go verbatim to YAML with no normalization.

## Goals / Non-Goals

**Goals:**
- `project_path` and `git_root_path` in YAML always store relative paths (relative to `workspace_path`)
- Config loading resolves them to absolute for all consumers — zero consumer changes needed
- `workspace_path` is required when projects exist; missing it with relative paths is a hard error
- Backend normalizes absolute browse-dialog paths to relative on register/update
- `workspace_path` is editable in the Setup view Workspace tab
- `project.subPath` is pre-computed at load time (simplifies `WorkingDirectoryResolver`)
- Dead `subrepo_path` column reference is removed

**Non-Goals:**
- Supporting mixed absolute/relative paths or fallback behavior
- Migrating other path fields (`worktree_base_path`, `workspace_path` itself)
- Automatic migration of existing `workspace.yaml` files (user must update manually, guided by error)

## Decisions

### Decision 1: Path utilities in a dedicated module (`src/bun/config/path-utils.ts`)

**Chosen**: Extract path logic into `src/bun/config/path-utils.ts` with three exports:

```
resolveConfigPath(base: string, relativePath: string): string
  → resolve(base, relativePath)  — relative→absolute at load time

toWorkspaceRelativePath(workspacePath: string, absolutePath: string): string
  → relative(workspacePath, absolutePath)  — absolute→relative for YAML writes

getEffectiveWorkspacePath(config: LoadedConfig): string
  → config.workspace.workspace_path ?? config.configDir
```

**Why**: Replaces the 4-site `workspace_path ?? configDir` pattern and centralizes path math. No fallback logic — callers that pass bad input get bad output (GIGO is fine; validation happens earlier).

**Alternative considered**: Inline resolution inside `loadConfig()` only. Rejected — `project-store.ts` also needs normalization, and the `getEffectiveWorkspacePath` pattern is used across handlers; centralization prevents drift.

---

### Decision 2: Validation and resolution flow inside `loadConfig()`

Path validation runs before project mapping:

```
1. Check: if workspace has projects, workspace_path must be set
   → return { config: null, error: "workspace_path is required when projects are defined. ..." }

2. For each project:
   a. Check: project_path must be relative (isAbsolute → config error with migration hint)
   b. Resolve: projectPath = resolve(workspacePath, project.project_path)
   c. If git_root_path set:
      - Check: must be relative (same guard)
      - Resolve: gitRootPath = resolve(workspacePath, project.git_root_path)
   d. Else: gitRootPath = projectPath   ← unchanged default
   e. Compute: subPath = relative(gitRootPath, projectPath)

3. LoadedProject gains: subPath: string
```

**Why**: Fail-fast at startup. All consumers receive absolute paths — no consumer changes needed. The `subPath` pre-computation eliminates the runtime `relative()` call in `WorkingDirectoryResolver`.

**Breaking change error format**:
```
Error: project "my-app": project_path must be a relative path (relative to workspace_path).
Found: /home/alice/repos/myapp
Migration: change project_path to the path relative to your workspace_path.
Example: if workspace_path is /home/alice/repos, use project_path: myapp
```

---

### Decision 3: Backend normalization in `project-store.ts`

`registerProject` and `updateProject` will:

1. Resolve `workspace_path` via `getEffectiveWorkspacePath(config)`
2. Validate `workspace_path` is set (error: "workspace_path must be set before registering projects")
3. Validate the given path exists on disk (`existsSync`)
4. Validate the path is inside `workspace_path` (`!relative(...).startsWith("..")`)
5. Convert to relative: `toWorkspaceRelativePath(workspacePath, absolutePath)`
6. Write relative value to YAML

**Why**: The browse dialog always produces absolute paths. The backend is the single normalization point; the frontend never needs to know about workspace_path to compute relative paths. This also means the RPC contract stays clean — the frontend sends what the user typed/selected.

---

### Decision 4: `WorkingDirectoryResolver` simplification

Current (runtime):
```typescript
const relSubPath = relative(gitRootPath, projectPath);
if (relSubPath.startsWith("..")) throw ...
const cwd = join(worktreePath, relSubPath);
```

After (load-time):
```typescript
const cwd = join(worktreePath, project.subPath);
```

The `".."` guard is replaced by the containment check at registration time (`project-store.ts`). The `subPath` is always valid if the project was accepted by the config loader.

---

### Decision 5: `workspace_path` exposed in `WorkspaceConfig` RPC

Add `workspacePath: string` to `WorkspaceConfig` in `rpc-types.ts`. The `workspace.getConfig` handler resolves it via `getEffectiveWorkspacePath(config)`. The frontend uses it to:
- Show an inline warning in `ProjectDetailDialog` when not set
- Pre-fill the field in `SetupView`

The `workspace.update` handler gains a `workspacePath?: string` parameter that writes `workspace_path` to YAML.

---

### Decision 6: `workspace_path` field placement in Setup view

Added as the **second field** in the Workspace tab (after name, before engine), because it is a prerequisite for the Projects tab to function. The field has a browse button (reuses the `workspace.openFolderDialog` RPC) and a sub-label: "Root folder containing all your projects (required to register projects)".

### Decision 7: Structured `{ absolute, relative }` path object in `Project` RPC type

**Chosen**: Change `Project.projectPath` and `Project.gitRootPath` in `rpc-types.ts` from `string` to `{ absolute: string; relative: string }`. Both `.relative` values are relative to `workspacePath`. `toProject()` in `project-store.ts` constructs this object at the RPC boundary using the resolved `LoadedProject` fields and `workspacePath`.

```
// rpc-types.ts
interface Project {
  projectPath: { absolute: string; relative: string }
  gitRootPath: { absolute: string; relative: string }
  ...
}

// project-store.ts
function toProject(loaded: LoadedProject, workspacePath: string): Project {
  return {
    projectPath: {
      absolute: loaded.projectPath,
      relative: toWorkspaceRelativePath(workspacePath, loaded.projectPath),
    },
    gitRootPath: { ... },
    ...
  }
}
```

**Why**: Gives the frontend both representations without requiring it to know `workspacePath`. Display uses `.relative`; FS operations (folder dialog, `lsp.detectLanguages`) use `.absolute`. Eliminates a class of silent bugs where display and FS code both used the same string but one was wrong.

**Impact**: Frontend must update `p.projectPath` → `p.projectPath.relative` for display, and `p.projectPath` → `p.projectPath.absolute` for FS/RPC calls (SetupView line ~124 and ~436, `ProjectDetailDialog` form fields).

---

### Decision 8: `getLoadedProjectByKey()` split — internal callers use `LoadedProject`

**Chosen**: Add `getLoadedProjectByKey(key: string, config: LoadedConfig): LoadedProject | null` to `project-store.ts`. This function returns the internal `LoadedProject` type (absolute string paths). The existing `getProjectByKey()` (returning the RPC `Project` type) is used only by `handlers/projects.ts`.

All engine and executor callers (~10 sites: orchestrator, chat-executor, working-directory-resolver, lsp handler, board-tools, tasks handler, launch handler) are migrated to `getLoadedProjectByKey`.

**Why**: Engine code works exclusively with absolute paths. If those callers used `getProjectByKey()` (returning `Project` with structured objects), they would have to append `.absolute` at every access site — noise with no benefit, and a potential source of bugs if someone accidentally uses `.relative` in a path join. The split keeps each function's return type aligned with its caller's domain.

---

## Risks / Trade-offs

| Risk | Mitigation |
|------|------------|
| Existing `workspace.yaml` files break on upgrade | Clear error with migration hint; update `.sample` file |
| Path outside workspace_path accidentally registered | `!relative(...).startsWith("..")` check in project-store with clear error |
| `subPath` is `""` for standalone repos (project = git root) | `join(worktreePath, "")` equals `worktreePath` — correct behavior |
| `workspace_path` not set on workspaces created before this feature | `getEffectiveWorkspacePath` falls back to `configDir` for the CWD-fallback callers; `workspace_path` is only strictly required when projects exist |

## Migration Plan

1. **User action**: In `workspace.yaml`, add `workspace_path: /absolute/path/to/workspace` and convert all `project_path` / `git_root_path` values to relative paths.
2. **Error guidance**: Config load errors include the exact migration hint (see Decision 2 format).
3. **Sample update**: `config/workspace.yaml.sample` is updated to show the new relative-path format with comments.
4. **No automated migration**: Out of scope. The error is clear enough for manual migration.

## Open Questions

*(none — all decisions resolved in exploration session)*
