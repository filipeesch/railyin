## Context

The SetupView is the only configuration surface in the application, but it is nearly read-only. Workspace settings (name, engine, model, worktree path) have no UI at all — users must edit `workspace.yaml` by hand. Projects can only be registered, never updated or deleted. There is no way to create a new workspace from the UI.

The underlying config system is fully capable: `patchWorkspaceYaml` writes changes to YAML, `ensureConfigExists` scaffolds new workspace directories, and `orchestrator.listModels()` already powers the model picker in chat. The gap is entirely in the API surface and frontend.

## Goals / Non-Goals

**Goals:**
- Add `workspace.create`, `workspace.update`, `workspace.resolveGitRoot`, `projects.update`, `projects.delete` RPCs
- Rebuild the Workspace tab in SetupView with form fields for all first-class settings
- Replace the project register-only form with a full list + ProjectDetailDialog (add / edit / delete)
- Expose `engine` type and `engine.model` in `WorkspaceConfig` RPC type and UI
- Strip `git_path` and `shell_env_timeout_ms` from YAML on write (deprecated, non-functional)

**Non-Goals:**
- Boards tab improvements (tracked separately as task #147)
- Workflow YAML editing (already handled by `WorkflowEditorOverlay`)
- Workspace deletion (destructive, out of scope for this change)
- Moving tasks between projects or workspaces

## Decisions

### Decision: Reuse `models.list` for the engine model picker
**Chosen**: The workspace settings model picker calls the existing `models.list` RPC — no new endpoint.

`models.list` already calls `orchestrator.listModels(workspaceKey)` which delegates to the active engine adapter. This means the same model list shown in the chat dropdown is shown in settings. When the user changes `engineType`, the frontend re-fetches `models.list` so the dropdown updates.

**Alternative considered**: A dedicated `workspace.listModels` RPC. Rejected — redundant, adds surface area, and the existing endpoint already has the right semantics.

---

### Decision: Text input + `workspace.resolveGitRoot` for folder picking
**Chosen**: Project path fields are `InputText` components. A "Detect git root" button calls the new `workspace.resolveGitRoot` RPC (`git -C <path> rev-parse --show-toplevel`) and auto-fills the Git root field.

**Alternative considered**: `<input type="file" webkitdirectory>`. Rejected — inconsistent across browsers for directory selection, and the Bun HTTP server can't pass native file dialogs through the web frontend anyway.

---

### Decision: `patchWorkspaceYaml` deep-merges `engine` block
**Chosen**: Extend the existing deep-merge logic in `patchWorkspaceYaml` to cover the `engine` block in addition to `anthropic`.

The current implementation does `{ ...current, ...patch }` which would clobber `engine.type` if only `engine.model` is patched. Fix: when `patch.engine` and `current.engine` are both present, merge them: `{ ...current.engine, ...patch.engine }`.

Also: on every write, delete `git_path` and `shell_env_timeout_ms` keys from the merged object before serialising to YAML.

---

### Decision: `projects.delete` cascades to tasks via existing DB foreign key behaviour
**Chosen**: The backend `projects.delete` handler removes the project entry from `workspace.yaml`, then deletes all `tasks` rows with matching `project_key` and `board.workspace_key`. Conversations and executions cascade via existing SQLite `ON DELETE CASCADE` constraints.

The frontend shows a confirmation alert: _"Deleting this project will permanently delete all tasks and their history. This cannot be undone."_

**Alternative considered**: Soft-delete / archive. Rejected — the YAML is the source of truth and there is no archive concept in the current data model.

---

### Decision: `workspace.create` derives key from name
**Chosen**: The name the user types is passed to `workspace.create`. The backend sanitizes it to a key using the existing `sanitizeWorkspaceKey` function (`"My Team"` → `"my-team"`). The key is shown read-only in the creation dialog so the user knows the folder name. If the key already exists, the API returns an error.

The dialog auto-switches to the new workspace on success, landing the user on the Workspace tab ready to configure engine + projects.

---

### Decision: Engine selector is an enum, not free text
**Chosen**: The engine type field is a two-option Select: _GitHub Copilot_ (`copilot`) and _Claude Code_ (`claude`). The model dropdown below it is populated from `models.list` regardless of engine type — both engines implement `listModels()`.

## Risks / Trade-offs

- **`models.list` requires orchestrator**: The handler throws if the orchestrator is not initialized. In the settings UI, if a newly-created workspace has no valid engine config yet, `models.list` will fail. **Mitigation**: catch the error in the frontend store and show an empty model list with an inline warning.
- **patchWorkspaceYaml rewrite risk**: The merge logic change is small but touches every workspace save path. **Mitigation**: extend `workspace-handlers.test.ts` with cases that verify `engine` block deep-merge and deprecated key stripping.
- **Cascade delete is irreversible**: Deleting a project with many tasks permanently removes conversation history. **Mitigation**: confirmation dialog shows the count of tasks that will be deleted.

## Migration Plan

No database migrations needed. All changes are additive RPCs + frontend UI. The `patchWorkspaceYaml` fix is backward-compatible — it only affects future writes.

Deprecated YAML fields (`git_path`, `shell_env_timeout_ms`) are stripped on the next write operation for a workspace. Users who rely on `git_path` in config.yaml global defaults are unaffected (this change only touches workspace-level YAML writes).
