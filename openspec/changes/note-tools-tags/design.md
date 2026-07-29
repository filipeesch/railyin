## Context

Notes are currently untagged free-form markdown stored per conversation. The `task_notes` table has columns: `id`, `conversation_id`, `content`, `is_source_ai`, `created_at`, `updated_at`. The title column was dropped in migration 046.

The note tools stack spans 7 layers: DB migration → shared types → repository → API handlers → AI tool definitions → frontend RPC → UI components. Changes must flow through all layers consistently.

**Current state:**
- AI agents can create/list/update notes via `common-tools.ts`
- Frontend can create/list/update/delete notes via API handlers
- No filtering capability exists beyond conversation scope
- Tags column does not exist in the database

**Constraints:**
- SQLite JSON TEXT columns for arrays (project convention)
- AJV validation for tool arguments
- No WebSocket push for notes — client-side filtering only
- Tags are AI-agent only (no human tag input in UI)

## Goals / Non-Goals

**Goals:**
- Enable AI agents to tag notes at creation time
- Enable AI agents to filter notes by tags (OR matching)
- Enable AI agents to update tags on existing notes
- Display tags visually in the frontend as chips
- Provide client-side tag filtering in the notes panel
- Maintain backward compatibility — existing notes have null tags

**Non-Goals:**
- Human tag input in UI (AI-agent only)
- Tag hierarchy or taxonomy
- Tag search or fuzzy matching
- `delete_note` tool for AI agents
- WebSocket push for note changes
- Performance optimization for large tag sets

## Decisions

### Storage: JSON TEXT column
**Decision:** Store tags as JSON-serialized array in a `tags TEXT` column on `task_notes`.
**Rationale:** Consistent with project convention (`approved_commands`, `enabled_mcp_tools`, `project_keys`). Simpler than junction table — no new tables, no JOINs, minimal migration.
**Alternatives considered:** Junction table (normalized, but overkill for small tag sets per note).

### Filtering: OR matching
**Decision:** `list_notes({ tags?: string[] })` returns notes matching ANY of the specified tags.
**Rationale:** Broader results reduce false negatives. OR matching is more forgiving for AI agent use cases.
**Alternatives considered:** AND matching (more precise but returns fewer results).

### Tag normalization: trim + lowercase
**Decision:** Normalize tags via `tag.trim().toLowerCase()` before storage.
**Rationale:** Prevents duplicates from case/spacing differences. Reliable filtering.
**Limitations:** Original casing is lost in display (chips show lowercase).

### Empty array handling: no-op
**Decision:** `tags: []` is treated the same as omitting `tags`. Existing tags are preserved.
**Rationale:** Simpler semantics — no need to distinguish empty from omitted.
**Trade-off:** Agent cannot intentionally clear tags via empty array.

### Empty tag handling: silently discard
**Decision:** After normalization, remove any tag that results in an empty string.
**Rationale:** Forgiven — agent won't fail on stray whitespace. Clean data.
**Trade-off:** Agent doesn't know a tag was dropped.

### Deduplication: yes
**Decision:** Deduplicate tags using `new Set()` after normalization.
**Rationale:** Tags are a set semantically — duplicates add no value.

### Limits: 15 chars per tag, 4 tags per note
**Decision:** Truncate tags to 15 chars silently. Drop tags beyond 4 silently.
**Rationale:** Prevents abuse while keeping UX forgiving.
**Trade-off:** Silent truncation means agent doesn't know tags were modified.

### UI: Chips + tag bar with client-side filtering
**Decision:** Display tags as chips on note cards. Show horizontal tag bar above notes list for filtering. Filter is client-side (data already loaded).
**Rationale:** Intuitive UX. No extra API calls. Makes tags functional for users.
**Alternatives considered:** API-based filtering (requires new endpoint).

### Tag bar sorting: alphabetical
**Decision:** Tags in the horizontal bar are sorted alphabetically.
**Rationale:** Predictable, consistent ordering.

### Tag bar overflow: wrap
**Decision:** Tag bar wraps to multiple lines when tags exceed width.
**Rationale:** Simple CSS behavior. No truncation or scrolling needed.

### `buildCommonToolDisplay` cleanup
**Decision:** Remove stale `args.title` reference for `create_note` (title column dropped in migration 046).
**Rationale:** Dead code cleanup. Use content preview or no subject.

## Risks / Trade-offs

[Risk] SQLite JSON filtering may be slow on large datasets → Notes are scoped per conversation and typically small (<50 notes). Client-side filtering is used for UI.

[Risk] Silent tag truncation may confuse agents → 15 chars is generous for most tags. Agent can verify by calling `list_notes` after creation.

[Risk] OR matching returns too many results → Agent can use more specific tag combinations or filter results client-side.

[Risk] Tag normalization loses original casing → Acceptable trade-off for consistency. Chips display lowercase.

[Risk] Backward compatibility — existing notes have null tags → Null is handled gracefully. `tags: null` is equivalent to no tags.

## Migration Plan

**Migration:** `052_note_tags.ts` — `ALTER TABLE task_notes ADD COLUMN tags TEXT NULL`

**Rollback:** `DROP COLUMN tags` (SQLite limitation — may require table recreation on older versions). Migration includes `down()` function.

**Test DB:** Update `test/helpers.ts` to include `tags` column in test schema.
