## Why

The task detail drawer mixes conversation with metadata in a two-column layout that wastes horizontal space and buries navigation controls in a sidebar. Moving to a tabbed model gives the chat timeline full width while organising task metadata into a dedicated Info tab — and puts all task actions (workflow transitions, launch, tools) in one persistent toolbar row.

## What Changes

- **Remove** the right-side panel (workflow state, branch, worktree, execution stats, session notes, "Move to" buttons) from the drawer body
- **Add** a two-tab switcher: **Chat** and **Info**
- **Add** a persistent toolbar row below the header containing: tab switcher (left) + workflow select + terminal button + run button + tools button (right cluster)
- **Move** workflow state from the side panel into a select dropdown in the toolbar (shows current column, allows transition)
- **Move** the edit title/description button from the drawer header into the Info tab, next to the Description section
- **Remove** the execution state tag from the drawer header (exec badge stays in header as a standalone indicator)
- **Add** Info tab content: project info, worktree/branch metadata, task description rendered as markdown with inline edit button
- **Remove** session notes from the drawer (no longer surfaced in the UI)
- **Add** a Terminal button to the toolbar that opens a terminal at the worktree path
- Chat tab retains: full-width conversation timeline, changed files panel, todo panel, chat input

## Capabilities

### New Capabilities

- `chat-drawer-tabs`: Tab switcher (Chat / Info) embedded in the drawer toolbar row, with tab content and persistent state
- `task-info-tab`: Info tab content — project info, worktree/branch metadata, task description in markdown with edit action

### Modified Capabilities

- `task-detail`: Side panel removed; workflow navigation, toolbar layout, and header actions change

## Impact

- `src/mainview/components/TaskDetailDrawer.vue` — primary change surface
- `src/mainview/components/LaunchButtons.vue` — may need a terminal button variant
- `openspec/specs/task-detail/spec.md` — several requirements change (side panel, header actions, layout)
