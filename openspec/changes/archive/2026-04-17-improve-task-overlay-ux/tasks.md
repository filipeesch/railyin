## 1. Create Task Overlay Component

- [x] 1.1 Create TaskDetailOverlay.vue component following the pattern of TodoDetailOverlay.vue
- [x] 1.2 Implement dual view modes (Preview/Edit) for description content
- [x] 1.3 Add tabbed interface for switching between Preview and Edit modes
- [x] 1.4 Implement markdown rendering in Preview mode
- [x] 1.5 Add conditional editability for title and project fields based on task column
- [x] 1.6 Default to preview mode when opening overlay

## 2. Update Board View

- [x] 2.1 Modify BoardView.vue to position "Create Task" button below backlog column title
- [x] 2.2 Ensure "Create Task" button is only visible in backlog column
- [x] 2.3 Remove old header "New Task" button (keep only backlog column button)
- [x] 2.4 Replace CreateTaskDialog with TaskDetailOverlay for task creation
- [x] 2.5 Remove old CreateTaskDialog component
- [x] 2.6 Make backlog button icon-only (no text) to match old style

## 3. Update Task Detail Drawer

- [x] 3.1 Ensure edit button in TaskDetailDrawer.vue remains available for all tasks
- [x] 3.2 Update task detail drawer to open new TaskDetailOverlay component
- [x] 3.3 Maintain existing functionality for task deletion and other actions
- [x] 3.4 Remove old edit dialog implementation (cleanup)

## 4. Implement Conditional Editability Logic

- [x] 4.1 Add logic to determine if task is in backlog column
- [x] 4.2 Implement readonly state for title and project fields when task is not in backlog
- [x] 4.3 Hide save button in overlay for non-backlog tasks
- [x] 4.4 Ensure description content can still be viewed in both modes for all tasks

## 5. Styling and UI Consistency

- [x] 5.1 Ensure task overlay shares styling with todo overlay
- [x] 5.2 Implement consistent keyboard shortcuts (ESC to close)
- [x] 5.3 Add visual indicators for readonly fields
- [x] 5.4 Ensure responsive design works on different screen sizes

## 6. Testing and Validation

- [x] 6.1 Test task creation from backlog column button
- [x] 6.2 Verify conditional editability works correctly
- [x] 6.3 Test that edit button in drawer works for all tasks
- [x] 6.4 Verify save button behavior in different column contexts
- [x] 6.5 Test markdown rendering in preview mode
- [x] 6.6 Ensure no regressions in existing task functionality