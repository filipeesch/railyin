## Context

The current task management UI has several inconsistencies in how tasks are created and edited. The "New Task" button is positioned in the header, which is disconnected from the actual workflow of creating tasks in the backlog column. The editing experience differs between creation and modification, and there's no clear pattern for when task fields should be editable.

This design aims to create a more consistent and intuitive task management experience by following established patterns in the codebase (specifically the todo item editor) and aligning the UI with the natural workflow of task management.

## Goals / Non-Goals

**Goals:**
- Create a unified task overlay component that provides a consistent editing experience
- Position the task creation button contextually within the backlog column
- Implement conditional editability based on task workflow state
- Maintain the existing edit button in the task detail drawer for all tasks
- Follow existing UI patterns for consistency

**Non-Goals:**
- Changing the underlying task data model or API
- Adding new task metadata fields
- Implementing collaborative editing features
- Changing the board/column workflow structure

## Decisions

1. **Task Overlay Component Design**
   - Follow the same pattern as TodoDetailOverlay.vue with dual view modes (Preview/Edit)
   - Use a tabbed interface for description content only
   - Keep title and project fields above the tabbed content
   - Implement conditional editability based on task column position

2. **Contextual Task Creation Button**
   - Move the "New Task" button from the header to below the backlog column title
   - Maintain the same visual design as the current button
   - Ensure the button is only visible in the backlog column

3. **Conditional Editability**
   - When a task is in the backlog column, all fields (title, project, description) are editable
   - When a task is in any other column, title and project fields become readonly
   - Description can still be viewed in both Preview and Edit modes for non-backlog tasks
   - The save button is hidden for non-backlog tasks when in the overlay

4. **Edit Button Preservation**
   - Keep the edit button in the task detail drawer available for all tasks
   - This provides an alternative path for power users who need to access task editing

5. **Component Implementation**
   - Create a new TaskDetailOverlay.vue component following the pattern of TodoDetailOverlay.vue
   - Modify BoardView.vue to position the create button in the backlog column
   - Update TaskDetailDrawer.vue to maintain edit button functionality
   - Share common styling and behavior between todo and task overlays

## Risks / Trade-offs

**Risk**: Users might not discover the new task creation button in the column header
**Mitigation**: Add subtle visual cues or onboarding tooltips for new users

**Risk**: Readonly fields for non-backlog tasks might confuse users
**Mitigation**: Ensure clear visual indication of readonly state and provide explanatory tooltips

**Risk**: Maintaining consistency between two similar overlay components
**Mitigation**: Share common components and styling where possible, document the patterns
