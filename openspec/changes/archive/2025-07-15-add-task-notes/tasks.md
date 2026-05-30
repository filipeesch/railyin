## 1. Database

- [x] 1.1 Create migration `src/bun/db/migrations/045_task_notes.ts` — `task_notes` table with `id`, `conversation_id` (FK ON DELETE CASCADE), `title` (nullable), `content`, `is_source_ai`, `created_at`, `updated_at`; index on `conversation_id`
- [x] 1.2 Register migration in `src/bun/db/migrations/runner.ts`

## 2. Repository

- [x] 2.1 Create `src/bun/db/repositories/note-repository.ts` — `NoteRepository` class with `createNote`, `updateNote`, `deleteNote` (hard delete), `listByConversation`; constructor-injected `Database`
- [x] 2.2 Export `TaskNote` row type and domain type from the repository file

## 3. Shared Types & RPC Contract

- [x] 3.1 Add `TaskNote` interface to `src/shared/rpc-types.ts`
- [x] 3.2 Add `notes.list`, `notes.create`, `notes.update`, `notes.delete` entries to the `RpcMethods` map in `src/shared/rpc-types.ts`
- [x] 3.3 Add typed helper functions to `src/mainview/rpc.ts` — `listNotes`, `createNote`, `updateNote`, `deleteNote`

## 4. Backend Handler

- [x] 4.1 Create `src/bun/handlers/notes.ts` — `noteHandlers(db)` function with the four RPC method implementations
- [x] 4.2 Register `noteHandlers` in `src/bun/index.ts` alongside other handler registrations

## 5. LLM Tools

- [x] 5.1 Add `NoteRepository` to `CommonToolContext.repos` interface in `src/bun/engine/types.ts`
- [x] 5.2 Add `create_note`, `list_notes`, `update_note` tool definitions to `COMMON_TOOL_DEFINITIONS` in `src/bun/engine/common-tools.ts`
- [x] 5.3 Add `create_note`, `list_notes`, `update_note` cases to `executeCommonToolText` switch in `src/bun/engine/common-tools.ts`
- [x] 5.4 Inject `new NoteRepository()` into `repos.notes` in `src/bun/engine/claude/engine.ts`
- [x] 5.5 Inject `new NoteRepository()` into `repos.notes` in `src/bun/engine/copilot/engine.ts`
- [x] 5.6 Inject `new NoteRepository()` into `repos.notes` in `src/bun/engine/pi/engine.ts`
- [x] 5.7 Inject `new NoteRepository()` into `repos.notes` in `src/bun/engine/opencode/engine.ts`

## 6. Frontend Components

- [x] 6.1 Create `src/mainview/components/NotesPanel.vue` — lists notes (title or content preview + timestamp), "+ New" button, per-item delete with confirmation
- [x] 6.2 Create `src/mainview/components/NoteDetailOverlay.vue` — title input (optional) + markdown textarea (required), Save/Cancel/Delete actions; handles create and edit modes

## 7. Tab Integration

- [x] 7.1 Add `"notes"` to the `activeTab` union type in `TaskChatView.vue`
- [x] 7.2 Add Notes tab button after Decisions in the tab bar in `TaskChatView.vue`
- [x] 7.3 Render `<NotesPanel>` when `activeTab === 'notes'` in `TaskChatView.vue`
- [x] 7.4 Pass `conversationId` to `NotesPanel` and wire `task.updated` WS event to trigger a notes re-fetch
