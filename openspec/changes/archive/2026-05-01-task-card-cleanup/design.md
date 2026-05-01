## Context

`TaskCard.vue` currently shows: title, unread dot, execution-state badge, retry count (`↺ N`), and a file-changes counter (`⬡ N`). The file-changes badge triggers a `CodeReviewOverlay` via an event chain: `TaskCard → BoardColumn → BoardView`. The store (`taskStore`) maintains `changedFileCounts` and `refreshChangedFiles` to feed this badge.

The card has no project attribution. As boards grow to span multiple projects, users cannot identify a task's project without opening the drawer.

`CodeReviewOverlay` is already fully reachable from the task drawer via `ChangedFilesPanel` inside `TaskChatView`. The card badge is a redundant access path.

## Goals / Non-Goals

**Goals:**
- Show project name in the card footer, right-aligned in the same row as the execution badge.
- Remove file-changes badge and retry count from the card.
- Delete all code that exclusively served those removed elements (event chain, prop drilling, store state).
- Preserve the `file_diff` unread-detection logic in `taskStore` (separate concern from the badge).

**Non-Goals:**
- No backend or RPC changes.
- No changes to `CodeReviewOverlay` itself or its access from the drawer.
- No changes to `changedFileCounts` usage within `TaskChatView` / `ChangedFilesPanel`.

## Decisions

### D1: Store access pattern for project name in TaskCard

**Decision:** Call `useProjectStore()` directly inside `TaskCard.vue`.

**Rationale:** `TaskCard` already calls `useTaskStore()` directly — introducing a second store access is consistent with the established pattern. The alternative (prop-drilling `projectName` through `BoardColumn`) would require touching three files for a purely presentational change and couples `BoardColumn` to a concern it doesn't need to know about.

**Alternative considered:** Pass `projectName: string` prop via `BoardColumn`. Rejected — adds prop drilling with no architectural benefit.

### D2: Layout of project name in footer

**Decision:** Right-align project name in the existing `.task-card__footer` row by adding `justify-content: space-between`. No new DOM wrapper needed.

**Rationale:** The footer already uses `display: flex; align-items: center; gap: 8px`. One CSS property change achieves the desired left (badge) / right (project) split. The project label uses `font-size: 0.72rem`, `color: var(--p-text-muted-color)`, `text-overflow: ellipsis` with a `max-width` to handle long names gracefully within the 260px column.

### D3: Scope of changedFileCounts cleanup

**Decision:** Remove `changedFileCounts` ref, `refreshChangedFiles`, and their call sites entirely from `taskStore`. Retain only the `file_diff` branch inside `onTaskStreamEvent` / `onTaskNewMessage` that marks tasks as unread.

**Rationale:** `changedFileCounts` was only consumed by `TaskCard` (via the badge) and by `BoardColumn`/`BoardView` (via `v-memo` and prop threading). Once the badge is gone, all consumers are removed. `ChangedFilesPanel` in the drawer calls `api("tasks.getChangedFiles")` directly — it does not use the store ref.

### D4: v-memo simplification in BoardColumn

**Decision:** Remove `changedFileCounts[task.id]` from the `v-memo` dependency array.

**Rationale:** With the badge gone, the only card-level reactive dependencies are `task` (object identity) and `hasUnread(task.id)` (boolean). The memo array becomes `[task, hasUnread(task.id)]`. Since `useProjectStore().projects` is a shared reactive ref already consumed by other components, Vue's reactivity will re-render cards automatically when projects change — no explicit memo dependency needed.

## Risks / Trade-offs

- **[Risk] Project not found at render time** → `projectName` falls back to `task.projectKey` (the raw key string). Projects are loaded in `BoardView.onMounted` before tasks, so this is a brief flash on cold load only.
- **[Risk] Long project names overflow** → Mitigated by `max-width: 50%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap` on the label.
- **[Risk] Removing `refreshChangedFiles` breaks something unexpected** → Audited: only `TaskCard` badge and `BoardView`'s `onOpenReview` consumed it from the store. Both are removed. `ChangedFilesPanel` is self-contained.
