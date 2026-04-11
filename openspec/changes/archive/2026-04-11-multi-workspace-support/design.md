## Context

The codebase currently stores workspaces and projects in SQLite and treats workflows as board template IDs resolved at runtime. That is close to a multi-workspace UI, but it is not the storage model the product wants.

- A workspace should represent an isolated bucket such as "Work Projects" or "Personal Projects"
- Each workspace should own its own engine config, project list, and workflow files
- Workflows are not shared globally; they are local to a workspace
- Boards, tasks, executions, and messages can stay DB-backed for now
- Workspace and project definitions should move out of SQLite entirely

So the real design constraint is separating two layers cleanly:

```text
filesystem:
  workspace
  projects
  engine config
  workflows

sqlite:
  boards
  tasks
  executions
  messages
```

## Goals / Non-Goals

**Goals**

- Support multiple workspaces in one installation
- Store workspaces and projects as files under the user's home config directory
- Give each workspace its own engine/config/workflow set
- Allow simultaneous executions in different workspaces
- Keep workflows local to the workspace that defines them
- Surface unread task activity with card markers, workspace-tab aggregation, and toasts
- Preserve a migration path from the current DB-backed workspace/project records

**Non-Goals**

- Cross-workspace task moves or shared boards
- Full workspace CRUD inside the UI in this change
- Per-workspace notification preferences
- Moving boards/tasks/executions/messages out of SQLite in this change

## Decisions

### D1: Filesystem folders become the source of truth for workspaces

The app should discover workspaces from the filesystem, not from workspace rows in SQLite. The top-level layout becomes:

```text
~/.railyin/
└── workspaces/
    ├── work/
    │   ├── workspace.yaml
    │   └── workflows/
    └── personal/
        ├── workspace.yaml
        └── workflows/
```

Each folder name is the stable workspace key. The workspace file stores the user-visible workspace metadata, engine config, and project list.

Example shape:

```yaml
name: Work Projects
engine:
  type: copilot
projects:
  - key: api
    name: Company API
    project_path: /Users/me/src/company-api
    git_root_path: /Users/me/src/company-api
    default_branch: main
```

This gives the product the storage boundary it wants: a workspace is a self-contained folder.

### D2: Projects are stored in the workspace file, not in SQLite

The `projects` table should stop being source-of-truth storage. Instead, the project list lives in `workspace.yaml` and is loaded with the rest of the workspace config.

That means project identity should become file-stable rather than DB-row-stable. The cleanest canonical identifier is a `project.key` string stored in the workspace file. Old integer `project_id` values can exist temporarily during migration, but the design target is project-key-based references.

### D3: Workflows are workspace-local and not shared

Workflow files remain YAML, but they are explicitly local to the workspace that owns them:

```text
~/.railyin/workspaces/<workspace>/workflows/*.yaml
```

Boards can still store a `workflow_template_id` in SQLite, but resolution of that ID happens against the active board's owning workspace. Two workspaces may both have a `delivery` workflow ID, but they are not shared assets.

### D4: Executions resolve engine from the task's workspace

Engine configuration remains per workspace. The orchestrator should resolve execution context from the task's owning board and then load that workspace folder's config:

```text
task -> board -> workspace key -> workspace.yaml -> engine resolver
```

That keeps simultaneous executions safe even when one workspace uses `copilot` and another uses `native`.

### D5: The board header becomes a two-level navigator

The board surface will have:

```text
┌─────────────────────────────────────────────────────────────┐
│ [Main] [Support •] [Research]            settings new task │
│ [Board select within active workspace]   edit workflow     │
├─────────────────────────────────────────────────────────────┤
│ columns for the active board in the active workspace       │
└─────────────────────────────────────────────────────────────┘
```

- Top row: workspace tabs
- Second control: board selector filtered to boards in the active workspace
- Existing board selector behavior remains, but only within the chosen workspace

Unread workspace activity is represented as a small blue dot on the tab header. Each task card also gets its own unread marker when it has unseen meaningful activity. Workspace unread state is derived from its tasks: if any card in that workspace is unread, the workspace tab is unread too.

### D6: Unread activity is tracked per task and aggregated upward

`App.vue` already receives `onTaskUpdated(task)`. The missing piece is state-diffing plus workspace awareness.

Add client-side task update classification:

- keep the previous task snapshot per task ID
- detect meaningful state transitions:
  - `workflowState` changed
  - `executionState` changed
- optionally persisted message-level events we want the user to notice
- ignore the first snapshot loaded from RPC

When a meaningful activity event occurs, the app should:

- mark that task card unread
- show a toast with workspace name, task title, and new state
- recompute workspace unread state from the tasks it owns

The unread marker clears when the user opens that task in the drawer. A workspace tab clears only when all unread tasks inside that workspace have been seen.

Recommended toast mapping:

| New state | Severity | Summary |
|-----------|----------|---------|
| `running` | info | Task started |
| `waiting_user` / `waiting_external` | info | Task waiting |
| `completed` | success | Task completed |
| `failed` | warn | Task failed |
| workflow-only move | info | Task moved |

To avoid noise, token streaming must never mark unread or show toasts. Only discrete state changes or persisted activity events should count.

### D7: SQLite keeps execution data, but no longer owns workspace/project definitions

This change should not try to move the whole app out of SQLite. The lower-risk cut is:

- **filesystem owns:** workspaces, projects, workflows, engine config
- **SQLite owns:** boards, tasks, executions, messages, review state, enabled-model state

Boards and tasks therefore still live in one DB, but they should reference workspace and project identities that come from the filesystem model rather than from `workspaces.id` and `projects.id` as the primary truth.

### D8: Migration is part of apply work, not runtime startup

The change should include migration work for existing DB-backed workspace/project data, but that work should happen during implementation/apply, not implicitly inside app startup.

That means:

- no startup auto-migration path hidden in production code
- no standalone migration scripts checked into the repo
- the apply work updates code and handles the transition explicitly as part of the change

This keeps the runtime simple and makes the storage shift a deliberate engineering step instead of hidden boot logic.

## Risks / Trade-offs

- **Storage split complexity:** filesystem-backed workspaces/projects plus DB-backed boards/tasks is a mixed model. The upside is a smaller migration surface right now.
- **Identity migration:** moving from `workspace_id` and `project_id` toward file-backed keys requires careful mapping for boards and tasks already stored in SQLite.
- **Notification noise:** blindly toasting every update would be distracting. Limiting activity to discrete state/message events and suppressing first-snapshot loads keeps the signal focused.
- **Concurrent engine state:** provider caches and engine instances can no longer assume one workspace. Workspace-keyed caches are required to avoid config leakage across executions.
- **Workspace-local workflow duplication:** if workflows are not shared, the same template IDs may exist in multiple workspaces with different content. Resolution must always use workspace context.
