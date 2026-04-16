## Context

Railyin's todo system (`task_todos`) is a structured working-memory layer for AI task execution. Todos survive compaction and are re-injected into every AI execution as an `## Active Todos` system block. Today, _all_ non-deleted todos are injected regardless of the task's current board column (`workflow_state`).

Board columns represent distinct phases of work (e.g., `backlog`, `in-progress`, `review`, `done`). A task moves through columns as it progresses. Todos created for one phase are noise during another phase.

The change adds an optional `phase` column to `task_todos`, threading it through every layer: DB → AI tools → system injection → RPC → UI.

## Goals / Non-Goals

**Goals:**
- Allow todos to be scoped to a specific board column by name (`phase TEXT NULL`)
- Reduce AI context noise by filtering injected todos to the current phase
- Expose phase as a first-class field in AI tools, RPC, and the UI overlay
- Visually distinguish non-active-phase todos in `TodoPanel` (muted + badge)

**Non-Goals:**
- Automatically moving or completing todos when the task changes column
- Enforcing that a todo's phase matches valid column IDs (it's a free-text field; invalid values simply mean the todo is always muted)
- Column ordering or "past vs future" distinction — all non-matching phases are treated identically (muted)
- Any change to compaction, execution flow, or cross-task todo sharing

## Decisions

### D1: `phase` is stored as a plain TEXT column, not a FK to board columns

**Decision**: `phase TEXT NULL` — no foreign key, no enum constraint.

**Rationale**: Board columns are defined in YAML templates, not DB rows. FK would require a join table that doesn't exist. Free text is resilient to template changes (renaming a column doesn't break todos). Invalid phases simply cause the todo to always appear muted — a safe degradation. Validated via tool description guidance rather than DB constraint.

**Alternative considered**: An enum or CHECK constraint. Rejected — column names are dynamic (per-board YAML template).

---

### D2: System injection filters in the DB layer (`listTodos` gains `currentPhase?` param)

**Decision**: Add optional `currentPhase?: string` to `listTodos()`. When provided, SQL becomes `AND (phase IS NULL OR phase = ?)`. The call site in `workflow/engine.ts` passes `task.workflow_state`.

**Rationale**: Filtering in SQL is more efficient than fetching all rows and filtering in JS. It keeps the filtering logic in one place (testable in isolation). The application-layer alternative would duplicate concern and fetch unnecessary rows.

**Alternative considered**: Post-fetch filter in `workflow/engine.ts`. Rejected for the reasons above.

---

### D3: `list_todos` AI tool returns ALL todos with `phase` field (no tool-level filtering)

**Decision**: When the model calls `list_todos` explicitly, it receives all non-deleted todos including their `phase` field. No filtering by current column.

**Rationale**: The tool is a deliberate query — the model expects the full picture. Filtering the tool result would be surprising (create a todo, immediately can't list it). The system injection block is already filtered; the tool is the explicit inspection path. Tool description guidance steers the model toward not acting on future-phase todos prematurely.

**Alternative considered**: Filter `list_todos` to match injection. Rejected — breaks expectations and limits the model's ability to reason about upcoming work.

---

### D4: Symmetric muting — past-phase and future-phase todos are treated identically

**Decision**: A todo is muted in `TodoPanel` if and only if `todo.phase !== null && todo.phase !== task.workflowState`. No column ordering or "past vs future" distinction.

**Rationale**: Requires no knowledge of column ordering. Symmetric, predictable, and easy to implement. The risk of "silent past-phase loss" is mitigated by the muted state being visible (not hidden) and by the fact that the model sees all todos when it calls `list_todos`.

**Alternative considered**: Hide past-phase todos, or show them as fully active. Rejected — hiding causes silent data loss; showing fully active breaks the conceptual model of phase scoping.

---

### D5: Board columns reach `TodoDetailOverlay` via `boardId` prop + self-fetching

**Decision**: Thread `boardId` from `TaskDetailDrawer` → `TodoPanel` → `TodoDetailOverlay`. The overlay fetches `boards.list()` and extracts columns for the dropdown.

**Rationale**: Consistent with how `todoId` works today (overlay is self-sufficient for its data). `TaskDetailDrawer` already has `task.boardId`. The board list RPC is small and likely cached by the board store.

**Alternative considered**: Pass `columns: WorkflowColumn[]` from parent. Rejected — `TodoPanel` would become a pass-through conduit for data it doesn't use.

---

### D6: Phase badge shown only on muted todos

**Decision**: The column-name badge in `TodoPanel` is rendered only when the todo is muted (phase doesn't match current column). Active todos and column-agnostic todos show no badge.

**Rationale**: The badge exists to explain the muted state, not as decoration. Showing it on active todos adds noise without value.

## Risks / Trade-offs

- **Stale phase after column rename** → If a board template's column id is renamed, todos scoped to the old id will become permanently muted. Mitigation: column ids in the YAML are stable by convention; the muted state is visible and recoverable via the overlay's Phase dropdown.
- **`boards.list` called per overlay open** → Minor extra RPC cost. Mitigation: board list is small; the Pinia board store typically caches it so the cost is negligible.
- **Phase is free text, not validated** → A typo results in a permanently muted todo. Mitigation: the overlay dropdown constrains input to valid column ids; AI tool description warns to use exact workflow state ids.

## Migration Plan

1. DB migration `025_todo_phase` runs at startup: `ALTER TABLE task_todos ADD COLUMN phase TEXT NULL`. Safe — additive, existing rows get NULL (always active).
2. No data migration needed — NULL is the correct default for all existing todos.
3. Rollback: remove the column via another migration if needed; no data loss for existing todos.

## Open Questions

_(none — all key decisions resolved during exploration)_
