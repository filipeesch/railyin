## Purpose
Defines the model-controlled, DB-persisted todo list scoped to a task. Provides structured working memory that survives context compaction and enables context-rich handoffs across executions.

## Requirements

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

### Requirement: Model can retrieve a single todo with full fields
The system SHALL expose a `get_todo` tool accepting an `id`. For a live todo it SHALL return all fields: `id`, `number`, `title`, `description`, `status`. For a deleted todo it SHALL return a plain-text message (e.g. `Todo #2 "..." has been removed. Skip it and move to the next task.`) — the model MUST skip that item and not treat it as an error.

#### Scenario: Get existing todo
- **WHEN** the model calls `get_todo` with a valid id scoped to the current task
- **THEN** all fields are returned including the full description markdown

#### Scenario: Get deleted todo
- **WHEN** the model calls `get_todo` with the id of a deleted todo
- **THEN** a plain-text message is returned indicating the todo was removed and instructing the model to skip it

#### Scenario: Get non-existent todo
- **WHEN** the model calls `get_todo` with an id that does not exist for the current task
- **THEN** an error string is returned

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

### Requirement: Model can update todo status with a dedicated tool
The system SHALL expose an `update_todo_status` tool accepting `id` and `status`. Valid status values are `pending`, `in-progress`, `done`, `blocked`, and `deleted`. Setting status to `deleted` is the soft-delete mechanism — the item will be hidden from `list_todos` results. The tool SHALL return the updated `{ id, number, title, status }`. This is the ONLY tool that should be used for status changes and for soft-deleting todos.

#### Scenario: Soft-delete a todo via deleted status
- **WHEN** the model calls `update_todo_status` with `status: "deleted"`
- **THEN** the todo's status is set to `deleted` and it no longer appears in `list_todos` results

### Requirement: Model can list todos with id, number, and title
The system SHALL expose a `list_todos` tool that returns all non-deleted todos for the current task ordered by `number ASC, id ASC`. Each item SHALL include only `id`, `number`, and `title` — not the full description. The tool result SHALL render as a list in the tool call display.

#### Scenario: List todos returns ordered non-deleted items
- **WHEN** the model calls `list_todos` with todos at numbers 1.0, 2.5, 3.0 (one of which is deleted)
- **THEN** the two non-deleted todos are returned in number order

#### Scenario: List todos when none exist
- **WHEN** the model calls `list_todos` and no todos have been created
- **THEN** an empty array is returned

### Requirement: Model can bulk-reorder todos
The system SHALL expose a `reorganize_todos` tool accepting an array of `{ id: number, number: number }` objects. It SHALL update all provided todos' `number` values atomically in a single transaction. The tool result SHALL render as the updated list (id, number, title) in the tool call display.

#### Scenario: Reorganize reorders todos atomically
- **WHEN** the model calls `reorganize_todos` with `[{id:1, number:3.0}, {id:2, number:1.0}]`
- **THEN** todo 1 gets number=3.0 and todo 2 gets number=1.0 in a single transaction, and `list_todos` reflects the new order

#### Scenario: Reorganize with unknown id
- **WHEN** the model calls `reorganize_todos` with an id not belonging to the current task
- **THEN** an error is returned and no updates are applied

### Requirement: Todo tools have ALWAYS/NEVER guidance in tool descriptions
The tool descriptions for `create_todo`, `edit_todo`, `update_todo_status`, `list_todos`, `get_todo`, and `reorganize_todos` SHALL include explicit ALWAYS and NEVER statements guiding model behavior. These SHALL specify: when to create todos (multi-step work), that description is memory and must be thorough, when to use blocked vs deleted vs done, and how to use `get_todo` before editing.

#### Scenario: Tool description contains ALWAYS statement for create_todo
- **WHEN** the model receives the `create_todo` tool definition
- **THEN** the description contains at least one ALWAYS statement referencing description quality

### Requirement: Todo tool call results render with structured display
The system SHALL render todo tool results in the chat timeline with structured display:
- `create_todo` and `edit_todo`: header shows `#<number> · <title>`, content shows description as markdown preview
- `update_todo_status`: header shows `#<id> → <status>`, no content body
- `list_todos` and `reorganize_todos`: header shows tool label, content shows each item as `<number>  <title>` per line

#### Scenario: create_todo renders with number and description preview
- **WHEN** a `create_todo` tool result is displayed in the timeline
- **THEN** the header shows the number and title, and the content area shows the description as markdown

#### Scenario: list_todos renders as numbered list
- **WHEN** a `list_todos` tool result is displayed in the timeline
- **THEN** each todo appears as a line with its number and title

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

#### Scenario: User edits todo description via overlay
- **WHEN** the user clicks Edit in the overlay, modifies the description, and clicks Save
- **THEN** the updated description is persisted via RPC and the overlay shows the new content

#### Scenario: User deletes todo from overlay
- **WHEN** the user clicks the delete button in the overlay
- **THEN** the todo's status is set to `deleted` and it disappears from the TodoPanel list

### Requirement: User can create todos from the UI
The system SHALL provide a way for the user to create todos directly in the UI (not only via AI tool calls). A "+" button in the `TodoPanel` header SHALL open the `TodoDetailOverlay` in create mode with empty fields.

#### Scenario: User creates todo via UI
- **WHEN** the user clicks "+" in the TodoPanel, fills in number, title, and description, and clicks Save
- **THEN** a new todo is created via RPC and appears in the TodoPanel list

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
## ADDED Requirements

### Requirement: User cannot create new todos via UI
The system SHALL NOT provide any UI mechanism for users to create new todo items. Todo creation is exclusively controlled by the AI model via the `create_todo` tool.

#### Scenario: No create button in TodoPanel
- **WHEN** the user views the TodoPanel component
- **THEN** no `[+]` or "New todo" button is visible

#### Scenario: Model can still create todos
- **WHEN** the AI model calls `create_todo` tool
- **THEN** the todo is created successfully (no change to model capability)

---

### Requirement: User cannot see or edit todo numbers
The system SHALL hide todo execution numbers from the user interface. Numbers are internal to the model's execution planning and should not be visible or editable by users.

#### Scenario: No number display in TodoPanel list
- **WHEN** the user views the todo list in TodoPanel
- **THEN** each todo item shows only status icon and title (no number prefix)

#### Scenario: No number input in overlay
- **WHEN** the user opens the TodoDetailOverlay
- **THEN** no number input field is present in the header

#### Scenario: Model can still set numbers
- **WHEN** the AI model calls `create_todo` or `edit_todo` with a number parameter
- **THEN** the number is stored and used for execution ordering (no change to model capability)

---

### Requirement: User cannot edit todo status
The system SHALL NOT provide any UI control for users to change todo status. Status is exclusively controlled by the AI model via the `update_todo_status` tool.

#### Scenario: No status dropdown in overlay
- **WHEN** the user opens the TodoDetailOverlay
- **THEN** no status dropdown or status selection control is visible

#### Scenario: Model can still update status
- **WHEN** the AI model calls `update_todo_status` tool
- **THEN** the status is updated successfully (no change to model capability)

---

### Requirement: User cannot edit todo phase
The system SHALL NOT provide any UI control for users to change todo phase (workflow state scoping). Phase is exclusively controlled by the AI model via the `edit_todo` tool.

#### Scenario: No phase dropdown in overlay
- **WHEN** the user opens the TodoDetailOverlay
- **THEN** no phase dropdown or phase selection control is visible

#### Scenario: Model can still set phase
- **WHEN** the AI model calls `edit_todo` with a phase parameter
- **THEN** the phase is set successfully (no change to model capability)

---

### Requirement: User can only edit pending todo descriptions
The system SHALL allow users to edit the description field of todo items ONLY when the todo status is "pending". Todos with other statuses (in-progress, done, blocked) are read-only.

#### Scenario: Edit tab shown for pending todos
- **WHEN** the user opens a pending todo in the overlay
- **THEN** both "Preview" and "Edit" tabs are visible

#### Scenario: Edit tab hidden for non-pending todos
- **WHEN** the user opens a non-pending todo (in-progress, done, blocked) in the overlay
- **THEN** only "Preview" tab is visible (no "Edit" tab)

#### Scenario: Textarea shown for pending todos
- **WHEN** the user clicks "Edit" on a pending todo
- **THEN** a textarea is displayed for editing the description

#### Scenario: Preview only for non-pending todos
- **WHEN** the user opens a non-pending todo
- **THEN** only markdown preview is shown (no textarea, no edit mode)

#### Scenario: Save button only for pending todos
- **WHEN** the user opens a pending todo
- **THEN** Save and Cancel buttons are visible in the footer

#### Scenario: No save button for non-pending todos
- **WHEN** the user opens a non-pending todo
- **THEN** no footer with Save/Cancel buttons is shown

---

### Requirement: User can only delete pending todos
The system SHALL allow users to soft-delete todo items ONLY when the todo status is "pending". Todos with other statuses cannot be deleted via the UI.

#### Scenario: Delete button only for pending todos
- **WHEN** the user opens a pending todo in the overlay
- **THEN** a delete button (trash icon) is visible in the header

#### Scenario: No delete button for non-pending todos
- **WHEN** the user opens a non-pending todo (in-progress, done, blocked) in the overlay
- **THEN** no delete button is visible in the header

#### Scenario: Delete sets status to deleted
- **WHEN** the user clicks the delete button on a pending todo
- **THEN** the todo's status is set to "deleted" and it disappears from the todo list

---

### Requirement: Overlay follows PrimeVue visual pattern
The system SHALL use PrimeVue Button components for all interactive elements in the TodoDetailOverlay, following the visual pattern established by WorkflowEditorOverlay and CodeReviewOverlay.

#### Scenario: Header uses PrimeVue Button components
- **WHEN** the overlay header is rendered
- **THEN** close and delete buttons use PrimeVue Button with `severity="secondary" text rounded` and `severity="danger" text rounded` respectively

#### Scenario: Footer uses PrimeVue Button components
- **WHEN** the overlay footer is rendered (for pending todos)
- **THEN** Cancel and Save buttons use PrimeVue Button with `severity="secondary"` and `severity="primary"` respectively

#### Scenario: Tabs use PrimeVue Button components
- **WHEN** the overlay tabs are rendered
- **THEN** Preview and Edit buttons use PrimeVue Button with `severity="secondary"` and `:text` prop for active state

---

### Requirement: Overlay has proper dark mode support
The system SHALL provide complete dark mode support for the TodoDetailOverlay using PrimeVue semantic tokens and `html.dark-mode` ancestor selector.

#### Scenario: Light mode background
- **WHEN** the app is in light mode
- **THEN** overlay background uses `var(--p-surface-0, #fff)` and header/footer use `var(--p-surface-50, #f8fafc)`

#### Scenario: Dark mode background
- **WHEN** the app is in dark mode (`html.dark-mode` class present)
- **THEN** overlay background uses `var(--p-surface-900, #0f172a)` and header/footer use `var(--p-surface-800, #1e293b)`

#### Scenario: PrimeVue buttons handle dark mode
- **WHEN** the app is in dark mode
- **THEN** PrimeVue Button components automatically adapt via severity tokens (no manual overrides needed)

---

### Requirement: RPC validation for pending-only edits
The system SHALL validate on the backend that todo edits from the UI are only allowed for pending todos.

#### Scenario: Edit pending todo succeeds
- **WHEN** the UI sends an edit request for a pending todo
- **THEN** the backend accepts the edit and updates the description

#### Scenario: Edit non-pending todo fails
- **WHEN** the UI sends an edit request for a non-pending todo
- **THEN** the backend returns an error: "Can only edit description of pending todos"

#### Scenario: Delete pending todo succeeds
- **WHEN** the UI sends a delete request for a pending todo
- **THEN** the backend accepts the delete and sets status to "deleted"

#### Scenario: Delete non-pending todo fails
- **WHEN** the UI sends a delete request for a non-pending todo
- **THEN** the backend returns an error: "Can only delete pending todos"
