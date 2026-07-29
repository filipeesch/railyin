## 1. Database Migration

- [ ] 1.1 Create migration `052_note_tags.ts` — `ALTER TABLE task_notes ADD COLUMN tags TEXT NULL`
- [ ] 1.2 Add `down()` function to migration — `ALTER TABLE task_notes DROP COLUMN tags`
- [ ] 1.3 Register migration in the migration runner
- [ ] 1.4 Update `src/bun/test/helpers.ts` — add `tags TEXT` column to test DB schema

## 2. Shared Types

- [ ] 2.1 Extend `TaskNote` interface in `src/shared/rpc-types.ts` — add `tags: string[] | null`
- [ ] 2.2 Update `RailynAPI["notes.list"]` — add `tags?: string[]` to params
- [ ] 2.3 Update `RailynAPI["notes.create"]` — add `tags?: string[]` to params
- [ ] 2.4 Update `RailynAPI["notes.update"]` — add `tags?: string[]` to params

## 3. Repository Layer

- [ ] 3.1 Extend `TaskNote` and `TaskNoteRow` interfaces in `note-repository.ts` — add `tags` field
- [ ] 3.2 Update `mapRow()` — parse JSON tags with safe fallback (`JSON.parse` with try/catch, default to null)
- [ ] 3.3 Implement `normalizeTags(input?: string[]): string[] | null` — trim, lowercase, truncate 15 chars, deduplicate, limit 4, discard empty
- [ ] 3.4 Update `createNote()` — accept `tags?` in input, normalize and store as JSON
- [ ] 3.5 Update `updateNote()` — accept `tags?` in input, normalize and replace existing tags; preserve if omitted or empty array
- [ ] 3.6 Update `listByConversation()` — accept optional `{ tagFilter?: string[] }` param, filter with OR matching using JSON comparison
- [ ] 3.7 Update SQL queries to include `tags` column in INSERT and UPDATE statements

## 4. API Handlers

- [ ] 4.1 Update `notes.list` handler — accept `tags?` param, pass to repository filter
- [ ] 4.2 Update `notes.create` handler — accept `tags?` param, pass to repository
- [ ] 4.3 Update `notes.update` handler — accept `tags?` param, pass to repository

## 5. AI Tool Definitions (common-tools.ts)

- [ ] 5.1 Update `create_note` tool definition — add `tags` property (type: array, items: string, optional)
- [ ] 5.2 Update `list_notes` tool definition — add `tags` property (type: array, items: string, optional)
- [ ] 5.3 Update `update_note` tool definition — add `tags` property (type: array, items: string, optional)
- [ ] 5.4 Update `create_note` execution handler — extract and pass tags to repository
- [ ] 5.5 Update `list_notes` execution handler — extract and pass tags filter to repository
- [ ] 5.6 Update `update_note` execution handler — extract and pass tags to repository
- [ ] 5.7 Clean up `buildCommonToolDisplay` — remove stale `args.title` reference for `create_note`

## 6. Frontend RPC

- [ ] 6.1 Update `listNotes` in `src/mainview/rpc.ts` — add `tags?: string[]` to params type
- [ ] 6.2 Update `createNote` in `src/mainview/rpc.ts` — add `tags?: string[]` to params type
- [ ] 6.3 Update `updateNote` in `src/mainview/rpc.ts` — add `tags?: string[]` to params type

## 7. Frontend UI (NotesPanel.vue)

- [ ] 7.1 Add `selectedTag` ref state for client-side filtering
- [ ] 7.2 Compute `uniqueTags` from notes list — deduplicate, sort alphabetically
- [ ] 7.3 Render horizontal tag bar with "All" chip + unique tag chips (wrapping flex container)
- [ ] 7.4 Add click handler on tag chips — toggle filter, clear when clicking active tag or "All"
- [ ] 7.5 Compute `filteredNotes` from notes list based on `selectedTag` (client-side OR matching)
- [ ] 7.6 Render tags as chips on each note card (below AI badge, above content preview)
- [ ] 7.7 Add PrimeVue Chip component import and styling

## 8. Unit Tests — Repository (`note-repository.test.ts`)

### Tag Normalization (8 scenarios)
- [ ] 8.1 NR-9: createNote normalizes tags (trim + lowercase)
- [ ] 8.2 NR-10: createNote truncates tags > 15 chars
- [ ] 8.3 NR-11: createNote deduplicates tags
- [ ] 8.4 NR-12: createNote limits to 4 tags max
- [ ] 8.5 NR-13: createNote discards empty strings after normalization
- [ ] 8.6 NR-14: updateNote normalizes tags on update
- [ ] 8.7 NR-15: updateNote preserves tags when tags omitted
- [ ] 8.8 NR-16: empty tags array is no-op (preserves existing)

### Tag Storage (4 scenarios)
- [ ] 8.9 NR-17: createNote with tags persists JSON array
- [ ] 8.10 NR-18: createNote without tags persists null
- [ ] 8.11 NR-19: updateNote with tags replaces existing
- [ ] 8.12 NR-20: updateNote without tags preserves existing

### Tag Filtering (5 scenarios)
- [ ] 8.13 NR-21: listByConversation with tagFilter returns matching notes (OR)
- [ ] 8.14 NR-22: listByConversation without tagFilter returns all notes
- [ ] 8.15 NR-23: tagFilter is case-insensitive
- [ ] 8.16 NR-24: tagFilter with multiple tags uses OR matching
- [ ] 8.17 NR-25: tagFilter with no matches returns empty array

## 9. Unit Tests — Handlers (`note-handlers.test.ts`)

### API Contract (6 scenarios)
- [ ] 9.1 NL-4: notes.list with tags filter passes to repository
- [ ] 9.2 NL-5: notes.list without tags returns all notes
- [ ] 9.3 NC-3: notes.create with tags persists normalized tags
- [ ] 9.4 NC-4: notes.create without tags has null tags
- [ ] 9.5 NU-3: notes.update with tags replaces existing
- [ ] 9.6 NU-4: notes.update without tags preserves existing

## 10. Unit Tests — Tool Execution (`note-tools.test.ts`)

### AI Tool Execution (10 scenarios)
- [ ] 10.1 CNT-5: create_note with tags creates note with normalized tags
- [ ] 10.2 CNT-6: create_note without tags has null tags
- [ ] 10.3 CNT-7: create_note with empty tags array has null tags
- [ ] 10.4 CNT-8: create_note with > 4 tags limits to 4
- [ ] 10.5 LNT-5: list_notes with tags filter returns matching notes
- [ ] 10.6 LNT-6: list_notes with multiple tags uses OR matching
- [ ] 10.7 LNT-7: list_notes without tags returns all notes
- [ ] 10.8 UNT-5: update_note with tags replaces existing tags
- [ ] 10.9 UNT-6: update_note without tags preserves existing tags
- [ ] 10.10 UNT-7: update_note with empty tags array preserves existing

## 11. Unit Tests — Tool Registration (`common-tools-registration.test.ts`)

### Tool Definitions (3 scenarios)
- [ ] 11.1 CTR-N7: create_note has tags property (array, optional)
- [ ] 11.2 CTR-N8: list_notes has tags property (array, optional)
- [ ] 11.3 CTR-N9: update_note has tags property (array, optional)

## 12. Playwright E2E Tests (`notes.spec.ts`)

### Tag UI (6 scenarios)
- [ ] 12.1 T-N11: Notes with tags display chips on note cards
- [ ] 12.2 T-N12: Tag bar shows unique tags alphabetically
- [ ] 12.3 T-N13: Clicking tag chip filters notes client-side
- [ ] 12.4 T-N14: Clicking active tag clears filter
- [ ] 12.5 T-N15: Note without tags shows no chips
- [ ] 12.6 T-N16: Tag bar wraps with many tags

## 13. Validation & Type Checking

- [ ] 13.1 Run `bun run build` — verify TypeScript compilation succeeds
- [ ] 13.2 Run `bun test src/bun/test/note-repository.test.ts` — verify repository tests pass
- [ ] 13.3 Run `bun test src/bun/test/note-handlers.test.ts` — verify handler tests pass
- [ ] 13.4 Run `bun test src/bun/test/note-tools.test.ts` — verify tool tests pass
- [ ] 13.5 Run `bun test src/bun/test/common-tools-registration.test.ts` — verify registration tests pass
- [ ] 13.6 Run `bun run test:e2e:notes` — verify E2E tag UI tests pass
