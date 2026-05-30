## Why

Tasks currently have no lightweight free-form scratchpad — the AI and the user can only capture structured artifacts (decisions, todos). Notes fill that gap: a markdown text store where anything useful can be recorded, pinned to the task's conversation, and surfaced in a dedicated UI tab alongside Decisions.

## What Changes

- New `task_notes` SQLite table scoped to `conversation_id` (hard delete, cascade on conversation delete)
- New `NoteRepository` with full CRUD — follows the `DecisionRepository` pattern
- New `notes.*` RPC handlers (`notes.list`, `notes.create`, `notes.update`, `notes.delete`)
- Three new LLM tools added to `common-tools.ts`: `create_note`, `list_notes`, `update_note`
- `NoteRepository` injected into `CommonToolContext.repos` across all four engines (Claude, Copilot, Pi, OpenCode)
- New `NotesPanel.vue` component — list view with create/edit/delete
- New `NoteDetailOverlay.vue` — markdown editor for create and edit
- New **Notes** tab in `TaskChatView.vue` (after Decisions)
- Notes panel refreshes on `task.updated` WebSocket event

## Capabilities

### New Capabilities

- `task-note`: Note persistence model — DB schema, `NoteRepository`, RPC handler and shared types for notes scoped to a conversation
- `task-note-tools`: LLM tool surface — `create_note`, `list_notes`, and `update_note` registered in `common-tools.ts` and executed via `CommonToolContext.repos.notes`

### Modified Capabilities

- `engine-common-tools`: `CommonToolContext.repos` gains a `notes: NoteRepository` field; three new tool definitions are added to `COMMON_TOOL_DEFINITIONS`

## Impact

- **New files**: `src/bun/db/migrations/045_task_notes.ts`, `src/bun/db/repositories/note-repository.ts`, `src/bun/handlers/notes.ts`, `src/mainview/components/NotesPanel.vue`, `src/mainview/components/NoteDetailOverlay.vue`
- **Modified files**: `src/shared/rpc-types.ts`, `src/bun/engine/types.ts`, `src/bun/engine/common-tools.ts`, `src/bun/engine/claude/engine.ts`, `src/bun/engine/copilot/engine.ts`, `src/bun/engine/pi/engine.ts`, `src/bun/engine/opencode/engine.ts`, `src/bun/index.ts`, `src/mainview/rpc.ts`, `src/mainview/components/TaskChatView.vue`
- **No breaking changes** — purely additive
