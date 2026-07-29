## Why

Notes lack a way to categorize or filter them. As conversations grow, agents and users need to quickly find relevant notes among many. Tags provide a lightweight classification mechanism without introducing complex hierarchy or taxonomy.

## What Changes

- **create_note** tool gains an optional `tags` parameter (array of strings, max 4) to associate tags with new notes
- **list_notes** tool gains an optional `tags` parameter (array of strings) to filter notes by tag using OR matching
- **update_note** tool gains an optional `tags` parameter to modify tags on existing notes
- **TaskNote** type gains a `tags` field (string array)
- **task_notes** table gains a `tags` TEXT column (JSON-serialized)
- **NotesPanel.vue** displays tags as chips on note cards and a horizontal tag bar for client-side filtering
- Tags are normalized (trim + lowercase), deduplicated, limited to 15 chars per tag and 4 per note
- Existing `buildCommonToolDisplay` stale `args.title` reference for `create_note` is cleaned up

## Capabilities

### New Capabilities
- `note-tags`: Tag support for notes — creation with tags, filtering by tags, tag normalization, and UI display as chips with client-side filtering

### Modified Capabilities
- `task-note-tools`: Tool definitions extended with tags parameter support; list_notes gains filtering capability
- `task-note`: Persistence model extended with tags column; RPC contract extended for tag operations

## Impact

**Database:** New migration `052_note_tags.ts` adds `tags TEXT NULL` column to `task_notes` table. Test DB schema updated.

**Shared Types:** `TaskNote` interface in `rpc-types.ts` gains `tags: string[] | null`. RPC schema for `notes.list`, `notes.create`, `notes.update` extended.

**Backend:** 
- `note-repository.ts`: Tag normalization logic, storage, and filtering methods
- `common-tools.ts`: Tool definitions and execution handlers updated
- `handlers/notes.ts`: Accept tags in create/update/list operations

**Frontend:**
- `NotesPanel.vue`: Tag bar component, chip rendering, client-side filtering
- `rpc.ts`: Typed RPC calls extended with tags parameters
- `NoteDetailOverlay.vue`: No changes (tags are AI-agent only)

**Tests:** ~42 new test scenarios across 5 existing test files (extended, not created):
- `note-repository.test.ts`: Tag normalization (8), storage (4), filtering (5)
- `note-handlers.test.ts`: API contract (6)
- `note-tools.test.ts`: AI tool execution (10)
- `common-tools-registration.test.ts`: Tool definitions (3)
- `notes.spec.ts`: Playwright E2E tag UI (6)
