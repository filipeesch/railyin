## 1. Infrastructure

- [ ] 1.1 Add `task_notes` table DDL to `initDb()` in `src/bun/test/helpers.ts` — columns: `id`, `conversation_id` (FK ON DELETE CASCADE), `title` (nullable), `content`, `is_source_ai`, `created_at`, `updated_at`; index on `conversation_id`
- [ ] 1.2 Add `makeNote()` factory to `e2e/ui/fixtures/mock-data.ts` — returns a fully-typed `TaskNote` object with sensible defaults, following the `makeDecision()` pattern
- [ ] 1.3 Add `notes: new NoteRepository(db)` to `commonCtx()` factory in `src/bun/test/tasks-tools.test.ts`
- [ ] 1.4 Add `notes: new NoteRepository(db)` to `baseContext.repos` in `src/bun/test/common-tools-registration.test.ts`
- [ ] 1.5 Add `notes: new NoteRepository(db)` to `makeCommonCtx()` in `src/bun/test/column-groups.test.ts`
- [ ] 1.6 Add `notes: null as any` to the `repos` object in `src/bun/test/lsp.test.ts` (follows its existing `todos: null as any` pattern)

## 2. Repository Unit Tests

- [ ] 2.1 Create `src/bun/test/note-repository.test.ts` — `createNote` with content only, with title, with `isSourceAi: true`
- [ ] 2.2 Add `listByConversation` scenarios — empty result, insertion-order, cross-conversation isolation
- [ ] 2.3 Add `updateNote` scenarios — patch content, clear title with null, nonexistent id returns null
- [ ] 2.4 Add `deleteNote` scenarios — hard delete (row absent after), idempotent for nonexistent id
- [ ] 2.5 Add cascade delete scenario — delete parent conversation row, assert all notes removed

## 3. Handler Integration Tests

- [ ] 3.1 Create `src/bun/test/note-handlers.test.ts` — boilerplate: import `noteHandlers`, `initDb`, `seedProjectAndTask`, construct `noteHandlers(db)` in `beforeEach`
- [ ] 3.2 Add `notes.list` scenarios — empty result, returns all notes for conversation, cross-conversation isolation
- [ ] 3.3 Add `notes.create` scenarios — returns full `TaskNote` object, `isSourceAi` defaults to false
- [ ] 3.4 Add `notes.update` scenarios — patches content, clears title with null
- [ ] 3.5 Add `notes.delete` scenarios — note absent after delete, error on unknown id

## 4. LLM Tool Tests

- [ ] 4.1 Create `src/bun/test/note-tools.test.ts` — boilerplate: import `executeCommonTool`, `NoteRepository`, `initDb`, `seedProjectAndTask`, implement `commonCtx()` factory with `repos.notes: new NoteRepository(db)`
- [ ] 4.2 Add `create_note` scenarios — missing content returns error, content-only persists with `isSourceAi=true`, title+content both persisted
- [ ] 4.3 Add `list_notes` scenarios — no notes returns empty-state message, two notes returns content of both
- [ ] 4.4 Add `update_note` scenarios — missing `note_id` returns error, valid update patches content, `title: null` clears title, nonexistent id returns error

## 5. Common Tool Registration Tests

- [ ] 5.1 Add `describe("notes tools registration")` block to `src/bun/test/common-tools-registration.test.ts` — assert `create_note`, `list_notes`, `update_note` are in `COMMON_TOOL_DEFINITIONS`
- [ ] 5.2 Add assertions that note tool names appear in `buildCopilotTools(ctx)` output
- [ ] 5.3 Add assertions that note tool names appear in `buildClaudeToolServer(ctx)` output

## 6. Playwright UI Tests

- [ ] 6.1 Create `e2e/ui/notes.spec.ts` — boilerplate: import fixtures, define `openTaskDrawer` helper, stub `notes.list` returning `[]` as baseline
- [ ] 6.2 Add T-N1: Notes tab button is visible in task toolbar (positioned after Decisions)
- [ ] 6.3 Add T-N2 + T-N3: clicking Notes tab shows empty state; `notes.list` called with correct `conversationId`
- [ ] 6.4 Add T-N4: notes.list returns two notes → both items visible in panel
- [ ] 6.5 Add T-N5 + T-N6: clicking "+ New Note" opens overlay; filling form and saving calls `notes.create` → note appears in panel
- [ ] 6.6 Add T-N7 + T-N8: clicking existing note opens overlay prefilled; editing and saving calls `notes.update` → panel reflects change
- [ ] 6.7 Add T-N9: clicking delete calls `notes.delete` → note removed from panel
- [ ] 6.8 Add T-N10: `task.updated` WS push event triggers notes re-fetch and panel updates
