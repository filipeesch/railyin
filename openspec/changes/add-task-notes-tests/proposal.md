## Why

The `add-task-notes` feature introduces new backend repositories, RPC handlers, LLM tools, and a Vue frontend panel — none of which have test coverage. This change delivers the full test suite: repository unit tests, handler integration tests, LLM tool tests, and Playwright end-to-end UI tests.

## What Changes

- New `note-repository.test.ts` — unit tests for `NoteRepository` (in-memory SQLite, 14 scenarios)
- New `note-handlers.test.ts` — handler integration tests for `notes.*` RPC methods (9 scenarios)
- New `note-tools.test.ts` — LLM tool tests for `create_note`, `list_notes`, `update_note` via `executeCommonTool` (10 scenarios)
- New `notes.spec.ts` — Playwright end-to-end tests for the Notes tab UI (10 scenarios)
- Extended `common-tools-registration.test.ts` — assertions that note tools are registered in all engine tool formats
- Infrastructure updates to `helpers.ts` (`initDb` gains `task_notes` table) and `mock-data.ts` (`makeNote` factory)
- One-liner `repos.notes` additions to four existing test files that construct `CommonToolContext`

## Capabilities

### New Capabilities

- `task-note-tests`: Test coverage for the task notes feature — repository, handlers, LLM tools, and UI

### Modified Capabilities

- `task-note`: `initDb()` helper must include the `task_notes` table to support in-memory test execution

## Impact

- **New files**: `src/bun/test/note-repository.test.ts`, `src/bun/test/note-handlers.test.ts`, `src/bun/test/note-tools.test.ts`, `e2e/ui/notes.spec.ts`
- **Modified files**: `src/bun/test/helpers.ts`, `src/bun/test/tasks-tools.test.ts`, `src/bun/test/common-tools-registration.test.ts`, `src/bun/test/column-groups.test.ts`, `src/bun/test/lsp.test.ts`, `e2e/ui/fixtures/mock-data.ts`
- **No production code changes** — this change is tests only
- **Depends on**: `add-task-notes` must be implemented first (all test subjects must exist)
