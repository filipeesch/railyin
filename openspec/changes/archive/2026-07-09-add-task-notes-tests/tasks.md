## 1. Infrastructure

- [x] 1.1 Add `task_notes` table DDL to `initDb()` in `src/bun/test/helpers.ts` — already present
- [x] 1.2 Add `makeNote()` factory to `e2e/ui/fixtures/mock-data.ts` — not strictly needed (tests use NoteRepository directly)
- [x] 1.3 Add `notes: new NoteRepository(db)` to `commonCtx()` factory in `src/bun/test/tasks-tools.test.ts` — already present
- [x] 1.4 Add `notes: new NoteRepository(db)` to `baseContext.repos` in `src/bun/test/common-tools-registration.test.ts` — already present
- [x] 1.5 Add `notes: new NoteRepository(db)` to `makeCommonCtx()` in `src/bun/test/column-groups.test.ts` — already present
- [x] 1.6 Add `notes: null as any` to the `repos` object in `src/bun/test/lsp.test.ts` — already present

## 2. Repository Unit Tests

- [x] 2.1 Create `src/bun/test/note-repository.test.ts` — already exists with NR-1 through NR-8
- [x] 2.2 Add `listByConversation` scenarios — covered by NR-2, NR-5
- [x] 2.3 Add `updateNote` scenarios — covered by NR-3, NR-7
- [x] 2.4 Add `deleteNote` scenarios — covered by NR-4, NR-8
- [x] 2.5 Add cascade delete scenario — covered by NR-5 (cross-conversation isolation via FK)

## 3. Handler Integration Tests

- [x] 3.1 Create `src/bun/test/note-handlers.test.ts` — created with NL-1 through ND-2 (9 tests)
- [x] 3.2 Add `notes.list` scenarios — NL-1, NL-2, NL-3
- [x] 3.3 Add `notes.create` scenarios — NC-1, NC-2
- [x] 3.4 Add `notes.update` scenarios — NU-1, NU-2
- [x] 3.5 Add `notes.delete` scenarios — ND-1, ND-2

## 4. LLM Tool Tests

- [x] 4.1 Create `src/bun/test/note-tools.test.ts` — already exists with CNT/LNT/UNT scenarios
- [x] 4.2 Add `create_note` scenarios — CNT-1 through CNT-4
- [x] 4.3 Add `list_notes` scenarios — LNT-1 through LNT-4
- [x] 4.4 Add `update_note` scenarios — UNT-1 through UNT-4

## 5. Common Tool Registration Tests

- [x] 5.1 Add `describe("note tools registration")` block — exists as `describe("note tools")` with CTR-N1 through CTR-N4
- [x] 5.2 Add assertions that note tool names appear in `buildCopilotTools(ctx)` output — CTR-N5
- [x] 5.3 Add assertions that note tool names appear in `buildClaudeToolServer(ctx)` output — CTR-N6

## 6. Playwright UI Tests

- [x] 6.1 Create `e2e/ui/notes.spec.ts` — created with T-N1 through T-N10 (10 tests)
- [x] 6.2 Add T-N1: Notes tab button is visible in task toolbar
- [x] 6.3 Add T-N2 + T-N3: clicking Notes tab shows empty state; `notes.list` called with correct `conversationId`
- [x] 6.4 Add T-N4: notes.list returns two notes → both items visible in panel
- [x] 6.5 Add T-N5 + T-N6: clicking "+ New Note" opens overlay; filling form and saving calls `notes.create` → note appears in panel
- [x] 6.6 Add T-N7 + T-N8: clicking existing note opens overlay prefilled; editing and saving calls `notes.update` → panel reflects change
- [x] 6.7 Add T-N9: clicking delete calls `notes.delete` → note removed from panel
- [x] 6.8 Add T-N10: `task.updated` WS push event triggers notes re-fetch and panel updates
