## Context

Notes are a new first-class artifact type on Tasks. The codebase already has two analogous features that serve as implementation references:

- **Decisions** (`decision-record`, `engine-decision-common-tool`): DB-persisted records per `conversation_id`, a repository class, RPC handlers, LLM tools in `common-tools.ts`, and a read-only `DecisionsPanel.vue` tab.
- **Todos** (`task-todo-tool`): DB-persisted items per `task_id`, a `TodoRepository`, LLM tools in `common-tools.ts`, and a `TodoPanel.vue` with CRUD via `TodoDetailOverlay.vue`.

Notes follow the Decisions data-scoping pattern (`conversation_id` FK, works for both task conversations and standalone chat) and the Todos UI pattern (full human CRUD with an overlay editor).

## Goals / Non-Goals

**Goals:**
- Provide a free-form markdown scratchpad persisted per conversation
- Expose LLM tools (`create_note`, `list_notes`, `update_note`) in all four engines
- Human CRUD in a dedicated Notes tab in `TaskChatView.vue`
- Hard delete (physical row removal); cascade delete when conversation is deleted

**Non-Goals:**
- Auto-injection of note content into LLM context (notes are opt-in via tool call)
- Note versioning / revision history (unlike decisions, no audit trail required)
- Sharing notes across tasks or conversations
- Search or filtering within notes

## Decisions

### 1. Hard delete, no soft-delete column

Unlike decisions (which use `is_deleted = 1`), notes use hard `DELETE`. The UI doesn't need an undo/undelete flow, and note content is low-stakes scratchpad material. This simplifies the schema and repository.

`ON DELETE CASCADE` on `conversation_id` handles task deletion automatically at the DB level — no application-layer cleanup required.

### 2. `conversation_id` FK (not `task_id`)

Mirrors `decision_records`. Both task conversations and standalone chat sessions share the `conversations` table. Scoping notes to `conversation_id` means chat sessions can also use them in the future with zero schema change.

### 3. Opt-in LLM context injection (no `buildContextBlock`)

Decision records are auto-injected as a `<decisions>` XML block before every execution. Notes are not, because:
- Note content can be arbitrarily large markdown documents — auto-injection risks bloating the context window
- The LLM can call `list_notes` when it wants to see what notes exist, then `update_note` or `create_note` as needed
- This is a deliberate trade-off: LLM needs to be proactive, but context windows are protected

### 4. LLM tools: `create_note`, `list_notes`, `update_note` only

No standalone `delete_note` or `get_note` tool for the LLM. `list_notes` returns full content (not just titles) since notes are scratchpad-sized. If full content proves too large in practice, `get_note` can be added later.

### 5. `NoteRepository` injected into `CommonToolContext.repos`

Follows the established DI pattern: `repos.todos` (TodoRepository), `repos.decisions` (DecisionRepository), now `repos.notes` (NoteRepository). All four engines construct the context with `new NoteRepository()`.

### 6. UI refresh via `task.updated` WS event

No new push event type. The Notes panel watches for `task.updated` events (same as TodoPanel's `refreshTrigger` prop) and re-fetches. Notes are viewed between executions, so eventual consistency is acceptable.

### 7. CRUD UI via `NoteDetailOverlay.vue`

Follows `TodoDetailOverlay.vue` pattern: a modal/drawer overlay with a markdown textarea and title input. The `NotesPanel.vue` lists notes with a "+ New" button and per-item delete. Click a note to open the overlay for editing.

## Risks / Trade-offs

- **[Risk] LLM may not discover notes exist** → Mitigation: The `list_notes` tool description will instruct the LLM to call it proactively when the user might benefit from stored context. The system prompt can reference "use list_notes to recall stored notes."
- **[Risk] Large note content in `list_notes` response** → Mitigation: `list_notes` returns full content — if this proves too large, truncate to first 500 chars per note and add `get_note` tool. Deferred for now.
- **[Risk] `CommonToolContext.repos` growing wider** → Mitigation: Consider extracting to a named `ToolRepositories` interface (already proposed as a cleanup). Not blocking this change.

## Migration Plan

1. Add migration `045_task_notes.ts` — creates `task_notes` table
2. Add `NoteRepository` — pure addition, no existing code changes
3. Add `notes.*` handlers and register in `src/bun/index.ts`
4. Extend `rpc-types.ts` and `rpc.ts` — additive only
5. Add LLM tools to `common-tools.ts` and inject `NoteRepository` in all four engines
6. Add `NotesPanel.vue` + `NoteDetailOverlay.vue`
7. Add Notes tab to `TaskChatView.vue`

No data migration required. No breaking changes. Rollback: revert migration + remove new files.
