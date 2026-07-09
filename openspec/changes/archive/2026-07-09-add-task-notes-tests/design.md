## Context

The `add-task-notes` change adds a `NoteRepository`, `notes.*` RPC handlers, three LLM tools (`create_note`, `list_notes`, `update_note`), and a `NotesPanel.vue` tab. None of these have automated tests. The test infrastructure already includes in-memory SQLite helpers (`initDb`, `seedProjectAndTask`), a `CommonToolContext` DI pattern, and Playwright mocks (`ApiMock`, `WsMock`). Notes tests follow the exact same patterns as decisions and todos.

## Goals / Non-Goals

**Goals:**
- Full unit test coverage of `NoteRepository` via in-memory SQLite
- Handler integration tests for all four `notes.*` RPC methods
- LLM tool tests for `create_note`, `list_notes`, `update_note` via `executeCommonTool`
- Playwright tests for the Notes tab: empty state, list, create, edit, delete, WS refresh
- Registration coverage: note tools appear in all engine tool formats

**Non-Goals:**
- Mutation testing (handled by Stryker separately)
- Load/performance tests
- Testing note content rendering (markdown rendering is a shared concern)
- Any production code changes to improve testability — `NoteRepository` uses constructor DI already

## Decisions

### 1. `note-tools.test.ts` is a new file (not extending `tasks-tools.test.ts`)

`tasks-tools.test.ts` already covers all common tools. A dedicated `note-tools.test.ts` follows SRP, is independently runnable with `bun test note-tools.test.ts`, and sets a precedent for future tool-specific extractions. The small duplication of a `commonCtx()` factory is acceptable.

### 2. `initDb()` in `helpers.ts` must include `task_notes` table

`initDb()` creates all test tables inline (it does not run the migration runner). This is the established pattern — every new table is added here alongside existing ones. Adding `task_notes` to `initDb()` is not a "test-only code path" but a required maintenance step.

### 3. `CommonToolContext.repos` additions in existing test files are one-liners

When `notes: NoteRepository` is added to `CommonToolContext.repos`, four existing test files that construct the context must be updated. These are not structural changes — each is a single `notes: new NoteRepository(db)` or `notes: null as any` line following the exact existing pattern in each file.

### 4. Playwright test uses `ApiMock` only — no WS mock needed for CRUD

Note CRUD operations (create, update, delete) are HTTP API calls. The refresh-on-`task.updated` scenario requires `WsMock` for the push event. Both `ApiMock` and `WsMock` are already available in the Playwright fixture setup.

### 5. `makeNote()` factory added to `mock-data.ts`

Following `makeDecision()` and `makeTodo()` patterns. Returns a fully-typed `TaskNote` object with sensible defaults. Placed in `e2e/ui/fixtures/mock-data.ts` for sharing across all Playwright specs.

## Risks / Trade-offs

- **[Risk] Test files written before implementation** → Tests will fail to compile until `add-task-notes` is implemented. The test change should be merged after the feature change.
- **[Low risk] `lsp.test.ts` uses `null as any`** → This file tests LSP, not notes. Adding `notes: null as any` matches its existing pattern for `todos` and `decisions` and has no correctness implications.
