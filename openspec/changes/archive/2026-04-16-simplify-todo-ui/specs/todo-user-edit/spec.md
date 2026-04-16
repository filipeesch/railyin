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
