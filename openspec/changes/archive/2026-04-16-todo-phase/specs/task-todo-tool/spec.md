## MODIFIED Requirements

### Requirement: Todo schema includes number, description, and extended status values
The system SHALL store todos in `task_todos` with columns: `id` (INTEGER PK), `task_id` (FK), `number` (REAL, float ordering), `title` (TEXT), `description` (TEXT, required), `status` (TEXT), `phase` (TEXT, nullable), `created_at`, `updated_at`. Status values SHALL be: `pending`, `in-progress`, `done`, `blocked`, `deleted`. The `deleted` status SHALL serve as soft-delete. `phase` SHALL default to NULL, meaning the todo is always active regardless of the task's current board column.

#### Scenario: Todo created with all required fields
- **WHEN** a todo is created via `create_todo` with title, description, and number
- **THEN** a row is persisted in `task_todos` with the provided values, `status = 'pending'`, `phase = NULL`, and the integer `id` is returned

#### Scenario: Todo created with explicit phase
- **WHEN** a todo is created via `create_todo` with a `phase` value matching a board column id (e.g., `"review"`)
- **THEN** the row is persisted with `phase = 'review'`

#### Scenario: List todos excludes deleted items by default
- **WHEN** `list_todos` is called and some todos have `status = 'deleted'`
- **THEN** deleted todos are excluded from the returned list

#### Scenario: Get todo for deleted item returns skip message
- **WHEN** `get_todo` is called with the id of a deleted todo
- **THEN** a plain-text message is returned indicating the todo was removed and the model should skip it

---

### Requirement: Model can create todos with rich description
The system SHALL expose a `create_todo` tool. It SHALL accept: `number` (REAL, required), `title` (TEXT, required), `description` (TEXT, required — rich markdown spec), and `phase` (TEXT, optional — the workflow state id of the board column this todo belongs to; NULL/omitted means always active). The tool description SHALL use ALWAYS/NEVER statements to enforce thorough descriptions. The tool description SHALL explain that `phase` scopes the todo to a specific board column and that omitting it makes the todo column-agnostic. The tool SHALL return the created todo's `id`, `number`, `title`, and `phase`.

#### Scenario: Create todo with full fields
- **WHEN** the model calls `create_todo` with number=2.0, title="Refactor auth", description="## What to do\n..."
- **THEN** the todo is persisted and `{ id, number, title, phase: null }` is returned

#### Scenario: Create todo with phase
- **WHEN** the model calls `create_todo` with phase="review"
- **THEN** the todo is persisted with `phase = 'review'` and the returned item includes `phase: "review"`

#### Scenario: Create todo missing description
- **WHEN** the model calls `create_todo` without a description field
- **THEN** a validation error is returned indicating description is required

---

### Requirement: Model can edit todo content fields
The system SHALL expose an `edit_todo` tool accepting `id` and any combination of: `number`, `title`, `description`, and `phase` (TEXT or null — pass null/omit to clear the phase and make the todo column-agnostic). Status is NOT a field of `edit_todo` — use `update_todo_status` instead. At least one field besides `id` SHALL be required. The tool SHALL return the updated `{ id, number, title, phase }`.

#### Scenario: Update description after discovering new context
- **WHEN** the model calls `edit_todo` with an updated `description`
- **THEN** the new description replaces the old one and is returned by subsequent `get_todo` calls

#### Scenario: Set phase on existing todo
- **WHEN** the model calls `edit_todo` with `phase = "review"`
- **THEN** the todo's phase is updated and reflected in subsequent `list_todos` and `get_todo` calls

#### Scenario: Clear phase on existing todo
- **WHEN** the model calls `edit_todo` with `phase = null`
- **THEN** the todo's phase is set to NULL (always active) and `list_todos` returns `phase: null` for that item

#### Scenario: Edit non-existent todo
- **WHEN** the model calls `edit_todo` with an id not belonging to the current task
- **THEN** an error string is returned

---

### Requirement: Todos are injected into the system message on every execution
The system SHALL inject active todos for the task into the system/developer message on every AI execution. The injection SHALL be filtered to todos where `phase IS NULL OR phase = current_workflow_state` — todos scoped to other columns SHALL NOT be injected. The injection SHALL include `id`, `number`, `title`, and `status`. The block SHALL be omitted entirely when the filtered list is empty. This applies to all engines (native, Claude, Copilot).

#### Scenario: Injection when todos exist
- **WHEN** an AI execution is assembled and the task has one or more non-deleted todos with `phase IS NULL OR phase = current_workflow_state`
- **THEN** an `## Active Todos` block listing those todos is included in the system message

#### Scenario: Phase-filtered injection excludes out-of-phase todos
- **WHEN** a task has todos where some have `phase = "review"` and the task is in `workflow_state = "in-progress"`
- **THEN** the `## Active Todos` block does NOT include the review-phase todos

#### Scenario: No injection when all todos are out-of-phase
- **WHEN** a task's only non-deleted todos are scoped to a different column
- **THEN** no todo block is included in the system message

#### Scenario: No injection when todos list is empty
- **WHEN** an AI execution is assembled and the task has no todos
- **THEN** no todo block is included in the system message

---

### Requirement: User can view and edit todo details via UI overlay
The system SHALL provide a `TodoDetailOverlay` component that opens when a user clicks a todo item in the `TodoPanel`. The overlay SHALL show: number + title in the header (both editable), description as markdown preview with toggle to edit mode (textarea), status dropdown, and a **Phase** dropdown listing all board columns for the task's board plus a "— any phase —" option (persists as NULL). A delete button in the header SHALL soft-delete the todo. Save and Cancel buttons SHALL persist or discard changes. The overlay SHALL receive a `boardId` prop and fetch board columns internally to populate the Phase dropdown.

#### Scenario: User opens overlay and sees description preview
- **WHEN** the user clicks a todo item in the TodoPanel
- **THEN** the TodoDetailOverlay opens showing the number, title, description as rendered markdown, and the current phase selection

#### Scenario: User sets phase via dropdown
- **WHEN** the user opens the overlay, selects a column from the Phase dropdown, and clicks Save
- **THEN** the todo's phase is persisted via RPC and reflected in TodoPanel (muted if it no longer matches the current column)

#### Scenario: User clears phase via dropdown
- **WHEN** the user opens the overlay, selects "— any phase —", and clicks Save
- **THEN** the todo's phase is set to NULL and it appears as active (unmuted) in TodoPanel regardless of the current column

#### Scenario: User deletes todo from overlay
- **WHEN** the user clicks the delete button in the overlay
- **THEN** the todo's status is set to `deleted` and it disappears from the TodoPanel list

---

### Requirement: RPC handlers support todo CRUD from UI
The system SHALL expose RPC handlers for: `todos.list`, `todos.get`, `todos.create`, `todos.edit`. `todos.create` params SHALL include optional `phase?: string`. `todos.edit` params SHALL include optional `phase?: string | null`. `todos.list` response SHALL include `phase: string | null` per item. `todos.get` response SHALL include `phase: string | null`. Deletion from the UI is performed via `todos.edit` with `status: "deleted"`.

#### Scenario: todos.get returns full todo record including phase
- **WHEN** the UI calls `todos.get` with a valid todoId and taskId
- **THEN** all fields including `phase` are returned

#### Scenario: todos.create persists phase
- **WHEN** the UI calls `todos.create` with taskId, number, title, description, and `phase: "review"`
- **THEN** the todo is created with `phase = 'review'` and the new id is returned

#### Scenario: todos.list returns phase per item
- **WHEN** the UI calls `todos.list`
- **THEN** each item in the response includes a `phase` field (string or null)

---

## ADDED Requirements

### Requirement: Phase-scoped todos appear muted in TodoPanel
The system SHALL render todos in `TodoPanel` with a visually muted style (reduced opacity, italic title) when the todo has a non-null `phase` that does not match the task's current `workflowState`. A small phase badge (showing the column id) SHALL be displayed on muted todos to explain why they are muted. Muted todos SHALL still be clickable and open the `TodoDetailOverlay`. Column-agnostic todos (phase is null) and todos whose phase matches the current column SHALL appear with normal styling.

#### Scenario: Future-phase todo appears muted
- **WHEN** the task is in `workflow_state = "in-progress"` and a todo has `phase = "review"`
- **THEN** the todo is rendered with reduced opacity, italic title, and a `review` badge

#### Scenario: Past-phase todo appears muted
- **WHEN** the task is in `workflow_state = "in-progress"` and a todo has `phase = "backlog"`
- **THEN** the todo is rendered with reduced opacity, italic title, and a `backlog` badge

#### Scenario: Matching-phase todo appears normal
- **WHEN** a todo has `phase = "in-progress"` and the task is in `workflow_state = "in-progress"`
- **THEN** the todo is rendered with normal styling (no reduced opacity, no badge)

#### Scenario: Column-agnostic todo appears normal
- **WHEN** a todo has `phase = null`
- **THEN** the todo is rendered with normal styling regardless of the task's current column

#### Scenario: Muted todo is still clickable
- **WHEN** the user clicks a muted (phase-mismatched) todo in TodoPanel
- **THEN** the TodoDetailOverlay opens for that todo, allowing the user to view or edit it

### Requirement: list_todos AI tool returns phase field for all items
The system SHALL return `phase: string | null` for each item in the `list_todos` AI tool response. The tool SHALL NOT filter by the current workflow state — it SHALL always return all non-deleted todos. The tool description SHALL note that phase-inactive todos exist and explain that the system injection handles filtering automatically.

#### Scenario: list_todos includes phase for all items
- **WHEN** the model calls `list_todos` and the task has todos with various phase values
- **THEN** all non-deleted todos are returned, each including a `phase` field (string or null)

#### Scenario: list_todos returns out-of-phase todos
- **WHEN** the task has a todo with `phase = "review"` and is currently in `workflow_state = "backlog"`
- **THEN** `list_todos` still returns that todo with `phase: "review"`
