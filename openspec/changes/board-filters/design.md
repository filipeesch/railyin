## Context

The board view (`BoardView.vue`) displays tasks grouped by workflow state columns. Currently, every task for the active board renders in every column regardless of its project. Tasks already carry a `projectKey` field, but no filtering is applied. The project store (`projectStore`) loads all projects with their workspace association. The board header already uses PrimeVue `Select` for board selection.

**Current board header layout:**
```
┌──────────────────────────────────────────────────────┐
│ [Workspace Tabs] [Board Select]    [Dark] [⚙️] [💬] │
└──────────────────────────────────────────────────────┘
```

## Goals / Non-Goals

**Goals:**
- Add a project filter Select in the board header right side
- Filter all columns globally based on selected project
- Default to "all projects" (no filter) matching current behavior
- Scope filter options to the current workspace and board's `projectKeys`
- Keep filter logic purely presentational (no store/backend changes)

**Non-Goals:**
- Per-column project filtering
- Backend API changes for project filtering
- Persisting filter preference across board/workspace switches
- E2E/UI tests for this feature (handled separately)

## Decisions

### 1. Filter state lives in BoardView (not a store)
**Decision:** Use a `ref<string | null>` in `BoardView.vue` for `selectedProjectKey`.

**Rationale:** The filter is purely presentational — it only affects which tasks are rendered, not data loading or mutations. Storing it in the board store would add unnecessary coupling. A component-level ref keeps the change minimal and reversible.

**Alternatives considered:**
- *Store-level state*: Would require modifying `board.ts` or creating a new filter store. Adds indirection for a simple computed filter.
- *URL query params*: Overkill for a UI-only filter that doesn't need sharing or deep-linking.

### 2. Filter applied in `columnTasksMap` computed property
**Decision:** The `columnTasksMap` computed property filters tasks before grouping by workflow state.

**Rationale:** This is the single point where tasks are materialized for rendering. Filtering here means zero downstream changes — `BoardColumn` and `TaskCard` remain unchanged.

```typescript
const columnTasksMap = computed<Record<string, Task[]>>(() => {
  const boardId = boardStore.activeBoardId;
  if (!boardId) return {};
  let tasks = taskStore.tasksByBoard[boardId] ?? [];
  
  // Apply project filter
  if (selectedProjectKey.value != null) {
    tasks = tasks.filter(t => t.projectKey === selectedProjectKey.value);
  }
  
  // ... rest unchanged: group by workflowState, sort by position
});
```

### 3. Filter options derived from board.projectKeys ∩ workspace projects
**Decision:** The Select options are computed as the intersection of the board's `projectKeys` and workspace projects. If the board has no `projectKeys` set, show all workspace projects.

**Rationale:** Boards can declare which projects they belong to via `projectKeys`. Respecting this keeps the filter relevant. When no projectKeys are set on the board, we fall back to showing all workspace projects.

```typescript
const projectFilterOptions = computed(() => {
  const workspaceKey = workspaceStore.activeWorkspaceKey;
  if (!workspaceKey) return [];
  
  let projectKeys = projectStore.projects
    .filter(p => p.workspaceKey === workspaceKey)
    .map(p => p.key);
  
  // Narrow to board's declared projects if set
  const board = boardStore.activeBoard;
  if (board?.projectKeys?.length > 0) {
    projectKeys = projectKeys.filter(k => board!.projectKeys!.includes(k));
  }
  
  return projectKeys.map(key => {
    const project = projectStore.projects.find(p => p.key === key);
    return { label: project?.name ?? key, value: key };
  });
});
```

## Risks / Trade-offs

| Risk | Mitigation |
|---|---|
| Filter state resets on board switch | Acceptable — different boards may have different project associations. Filter resets to "all" which is correct. |
| Empty filter dropdown if board.projectKeys don't match workspace projects | Edge case but possible. Will show empty Select — user can't filter, which is harmless. |
| `columnTasksMap` re-computes on every task change | Already does this for grouping/sorting. Adding one `filter()` call is negligible. |

## Migration Plan

No migration needed. This is a pure frontend addition:
1. Add `selectedProjectKey` ref
2. Add `Select` component to template
3. Add `projectFilterOptions` computed
4. Add filter condition in `columnTasksMap`

Rollback: revert the single file change.

## Open Questions

None. All decisions recorded in the explore phase decisions.
