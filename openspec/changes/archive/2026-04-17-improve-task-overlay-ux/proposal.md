## Why

The current task creation and editing experience has several UX issues that impact both new and experienced users. The "New Task" button is positioned in the header, disconnected from the context where tasks are actually created. Task editing is inconsistent between creation and modification workflows, and there's no clear distinction between editable and readonly states based on task workflow position.

## What Changes

- Move the "New Task" button from the header to below the backlog column title for better contextual placement
- Create a unified task overlay component that follows the same pattern as the todo item editor with dual view modes (Preview/Edit)
- Implement conditional editability where task title and project are editable only when in the backlog column
- Ensure the edit button in the task detail drawer remains available for all tasks regardless of column
- Add tabbed interface for description content with Preview/Edit modes for markdown rendering

## Capabilities

### New Capabilities
- `task-overlay`: Unified overlay component for task creation and editing with markdown support
- `contextual-task-creation`: Task creation button positioned contextually within the backlog column

### Modified Capabilities
- `task-management`: Enhanced task editing workflow with conditional editability based on task state
- `board-column-ui`: Column header UI with contextual task creation button

## Impact

- Vue components in src/mainview/components/ will be modified
- BoardView.vue will need updates to column header UI
- TaskDetailDrawer.vue will maintain edit button functionality
- CSS styles will be updated for new overlay component
- No breaking API changes, purely UI/UX improvements
