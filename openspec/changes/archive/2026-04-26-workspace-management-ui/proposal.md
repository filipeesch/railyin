## Why

The SetupView is the only UI for configuring workspaces and projects, but it is effectively read-only: users are told to edit YAML files by hand, engine/model selection has no UI at all, and projects can only be registered — never edited or deleted. This makes onboarding confusing, multi-workspace setups fragile, and the "default AI model" feature invisible to users despite being fully supported in config.

## What Changes

- **New**: Create a workspace from the UI (name → auto-derived key → `workspace.yaml` scaffolded on disk)
- **New**: Edit workspace settings in the UI: name, engine type (`copilot` | `claude`), default model, and worktree base path
- **New**: Select the workspace's default AI model via the existing `models.list` endpoint (no new endpoint needed)
- **New**: Full project CRUD — edit and delete existing projects, not just register new ones
- **New**: Project detail dialog with auto-detected git root (calls `workspace.resolveGitRoot` backend helper)
- **New**: Cascade warning when deleting a project ("all tasks associated with this project will be deleted")
- **Removed**: `git_path` and `shell_env_timeout_ms` fields stripped from workspace YAML and all UI references (deprecated, non-functional)
- **Removed**: The "Edit `~/.railyn/workspaces/<workspace>/workspace.yaml`" hint replaced by real form fields

**New backend RPCs:**
- `workspace.create` — scaffolds a new workspace folder with default config
- `workspace.update` — patches name, engine type, engine model, worktree base path
- `workspace.resolveGitRoot` — runs `git rev-parse --show-toplevel` for a given path
- `projects.update` — edits an existing project entry in `workspace.yaml`
- `projects.delete` — removes a project and cascades deletion to all its tasks/conversations

## Capabilities

### New Capabilities
- `workspace-management`: Full lifecycle management of workspaces — create, rename, configure engine and default model, set worktree path. Covers the `workspace.create` and `workspace.update` RPCs and the new Workspace tab in SetupView.
- `project-management`: Full CRUD for projects within a workspace — register, edit (paths, branch, description), delete with cascade warning. Covers `projects.update`, `projects.delete`, and the `ProjectDetailDialog` component.

### Modified Capabilities
- `workspace`: Add requirements for workspace creation via UI and in-UI editing of engine/model/name/worktree-path settings. Remove `git_path` and `shell_env_timeout_ms` from the supported config surface.
- `project`: Add requirements for project editing and deletion (with cascade) via UI, and for auto-detecting git root from project path.

## Impact

- **Backend**: `src/bun/handlers/workspace.ts` — 2 new handlers; `src/bun/handlers/projects.ts` — 2 new handlers; `src/bun/config/index.ts` — expose `ensureConfigExists` and extend `patchWorkspaceYaml` deep-merge to cover `engine` block; strip deprecated fields on write
- **Frontend**: `src/mainview/views/SetupView.vue` — major overhaul adding Workspace tab and rebuilt Projects tab; new `src/mainview/components/ProjectDetailDialog.vue`; `src/mainview/stores/workspace.ts` and `src/mainview/stores/project.ts` — add new RPC wrappers
- **Shared types**: `src/shared/rpc-types.ts` — add `engine` field to `WorkspaceConfig`; 5 new RPC method signatures
- **Tests**: New `e2e/ui/workspace-settings.spec.ts` Playwright suite; extend `src/bun/test/workspace-handlers.test.ts`
