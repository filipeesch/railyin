## ADDED Requirements

### Requirement: Todo schema includes number, description, and extended status values
The system SHALL store todos in `task_todos` with columns: `id` (INTEGER PK), `task_id` (FK), `number` (REAL, float ordering), `title` (TEXT), `description` (TEXT, required), `status` (TEXT), `created_at`, `updated_at`. Status values SHALL be: `pending`, `in-progress`, `done`, `blocked`, `deleted`. The `deleted` status SHALL serve as soft-delete.

#### Scenario: Todo created with all required fields
- **WHEN** a todo is created via `create_todo` with title, description, and number
- **THEN** a row is persisted in `task_todos` with the provided values, `status = 'pending'`, and the integer `id` is returned

#### Scenario: List todos excludes deleted items by default
- **WHEN** `list_todos` is called and some todos have `status = 'deleted'`
- **THEN** deleted todos are excluded from the returned list

#### Scenario: Get todo includes deleted items
- **WHEN** `get_todo` is called with the id of a deleted todo
- **THEN** a plain-text message is returned indicating the todo was removed and the model should skip it

### Requirement: Model can create todos with rich description
The system SHALL expose a `create_todo` tool. It SHALL accept: `number` (REAL, required), `title` (TEXT, required), `description` (TEXT, required — rich markdown spec). The tool description SHALL use ALWAYS/NEVER statements to enforce thorough descriptions. The tool SHALL return the created todo's `id`, `number`, and `title`.

#### Scenario: Create todo with full fields
- **WHEN** the model calls `create_todo` with number=2.0, title="Refactor auth", description="## What to do\n..."
- **THEN** the todo is persisted and `{ id, number, title }` is returned

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
The system SHALL expose an `edit_todo` tool accepting `id` and any combination of: `number`, `title`, `description`. Status is NOT a field of `edit_todo` — use `update_todo_status` instead. At least one field besides `id` SHALL be required. The tool SHALL return the updated `{ id, number, title }`.

#### Scenario: Update description after discovering new context
- **WHEN** the model calls `edit_todo` with an updated `description`
- **THEN** the new description replaces the old one and is returned by subsequent `get_todo` calls

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

#### Scenario: Reprioritize reorders todos atomically
- **WHEN** the model calls `reorganize_todos` with `[{id:1, number:3.0}, {id:2, number:1.0}]`
- **THEN** todo 1 gets number=3.0 and todo 2 gets number=1.0 in a single transaction, and `list_todos` reflects the new order

#### Scenario: Reprioritize with unknown id
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

### Requirement: User can view and edit todo details via UI overlay
The system SHALL provide a `TodoDetailOverlay` component (non-fullscreen) that opens when a user clicks a todo item in the `TodoPanel`. The overlay SHALL show: number + title in the header (both editable), description as markdown preview with toggle to edit mode (textarea). A delete button in the header SHALL soft-delete the todo (set status=deleted via RPC). Save and Cancel buttons SHALL persist or discard changes.

#### Scenario: User opens overlay and sees description preview
- **WHEN** the user clicks a todo item in the TodoPanel
- **THEN** the TodoDetailOverlay opens showing the number, title, and description as rendered markdown

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
The system SHALL expose RPC handlers for: `todos.list` (existing, updated), `todos.get`, `todos.create`, `todos.edit`. These SHALL be used by the UI overlay. The `todos.list` handler SHALL include `number` and `status` in its response. Deletion from the UI is performed via `todos.edit` with `status: "deleted"` — there is no separate `todos.delete` RPC.

#### Scenario: todos.get returns full todo record
- **WHEN** the UI calls `todos.get` with a valid todoId and taskId
- **THEN** all fields (id, number, title, description, status) are returned

#### Scenario: todos.create persists a new todo
- **WHEN** the UI calls `todos.create` with taskId, number, title, description
- **THEN** the todo is created and the new id is returned
