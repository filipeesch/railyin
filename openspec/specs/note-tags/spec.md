## Purpose

Defines the tag support for notes — creation with tags, filtering by tags, tag normalization, and UI display as chips with client-side filtering.

## Requirements

### Requirement: Notes support tags for classification and filtering
The system SHALL support tags on notes — a list of string labels (max 4) that categorize notes for filtering and display. Tags SHALL be stored as a JSON-serialized array in the `task_notes.tags` TEXT column.

#### Scenario: Note created with tags persists the tag array
- **WHEN** `create_note` is called with `tags: ["design", "architecture"]`
- **THEN** the note row has `tags = '["design","architecture"]'` in the database

#### Scenario: Note created without tags has null tags
- **WHEN** `create_note` is called without `tags` parameter
- **THEN** the note row has `tags = NULL` in the database

### Requirement: Tags are normalized before storage
The system SHALL normalize all tags before storage: trim whitespace, convert to lowercase, truncate to 15 characters. Empty strings after normalization SHALL be discarded. Duplicate tags SHALL be removed using set semantics.

#### Scenario: Tag is trimmed and lowercased
- **WHEN** `create_note` is called with `tags: [" Design ", "ARCHITECTURE"]`
- **THEN** tags are stored as `["design", "architecture"]`

#### Scenario: Tag longer than 15 chars is truncated
- **WHEN** `create_note` is called with `tags: ["very-long-tag-name-here"]`
- **THEN** tag is stored as `"very-long-tag-na"` (truncated to 15 chars)

#### Scenario: Empty tags after normalization are discarded
- **WHEN** `create_note` is called with `tags: ["design", "  "]`
- **THEN** tags are stored as `["design"]` (empty string discarded)

#### Scenario: Duplicate tags are deduplicated
- **WHEN** `create_note` is called with `tags: ["design", "design", "architecture"]`
- **THEN** tags are stored as `["design", "architecture"]`

#### Scenario: More than 4 tags are silently limited to 4
- **WHEN** `create_note` is called with `tags: ["a", "b", "c", "d", "e"]`
- **THEN** tags are stored as `["a", "b", "c", "d"]` (first 4 after normalization)

### Requirement: Empty tags array is treated as no-op
The system SHALL treat an empty `tags` array (`[]`) the same as omitting `tags`. Existing tags SHALL be preserved on update, and new notes created without tags SHALL have null tags.

#### Scenario: Create note with empty tags array results in null tags
- **WHEN** `create_note` is called with `tags: []`
- **THEN** the note has `tags = NULL`

#### Scenario: Update note with empty tags array preserves existing tags
- **WHEN** `update_note` is called with `tags: []` on a note with existing tags
- **THEN** the note's tags are unchanged

### Requirement: list_notes filters by tags using OR matching
The system SHALL support an optional `tags` parameter on `list_notes`. When provided, it SHALL return notes that have ANY of the specified tags. Tags SHALL be compared after normalization. When omitted, all notes for the conversation SHALL be returned.

#### Scenario: list_notes with tags filter returns matching notes
- **WHEN** `list_notes` is called with `tags: ["design"]` and notes exist with tags `["design"]` and `["architecture"]`
- **THEN** only the note with `"design"` tag is returned

#### Scenario: list_notes with multiple tags uses OR matching
- **WHEN** `list_notes` is called with `tags: ["design", "architecture"]` and notes exist with tags `["design"]` and `["architecture"]` and `["todo"]`
- **THEN** notes with `"design"` and `"architecture"` are returned (note with `"todo"` is excluded)

#### Scenario: list_notes without tags returns all notes
- **WHEN** `list_notes` is called without `tags` parameter
- **THEN** all notes for the conversation are returned regardless of tags

#### Scenario: list_notes tag filter normalizes comparison
- **WHEN** `list_notes` is called with `tags: ["Design"]` and a note has tags `["design"]`
- **THEN** the note is returned (case-insensitive match)

### Requirement: update_note supports tag updates
The system SHALL support an optional `tags` parameter on `update_note`. When provided, it SHALL replace the note's existing tags with the normalized new tags. When omitted, existing tags SHALL be preserved.

#### Scenario: Update note tags replaces existing tags
- **WHEN** `update_note` is called with `tags: ["new-tag"]` on a note with tags `["old-tag"]`
- **THEN** the note has tags `["new-tag"]`

#### Scenario: Update note without tags preserves existing tags
- **WHEN** `update_note` is called without `tags` parameter on a note with tags `["existing"]`
- **THEN** the note retains tags `["existing"]`

#### Scenario: Update note tags are normalized
- **WHEN** `update_note` is called with `tags: [" New Tag "]` on a note
- **THEN** the note has tags `["new tag"]` (normalized)

### Requirement: TaskNote type includes tags field
The system SHALL extend the `TaskNote` interface in `src/shared/rpc-types.ts` to include `tags: string[] | null`. All note operations SHALL include tags in their responses.

#### Scenario: TaskNote response includes tags
- **WHEN** any note operation returns a `TaskNote`
- **THEN** the response includes a `tags` field (array or null)

### Requirement: task_notes table has tags column
The system SHALL add a `tags TEXT NULL` column to the `task_notes` table via migration `052_note_tags`. The column SHALL be nullable to maintain backward compatibility with existing notes.

#### Scenario: Migration adds tags column
- **WHEN** migration `052_note_tags` is applied
- **THEN** `task_notes` table has a `tags TEXT NULL` column

#### Scenario: Existing notes have null tags after migration
- **WHEN** migration `052_note_tags` is applied to a database with existing notes
- **THEN** existing note rows have `tags = NULL`

### Requirement: NotesPanel displays tags as chips with tag bar filtering
The system SHALL display tags as colored chip components on each note card in `NotesPanel.vue`. A horizontal tag bar above the notes list SHALL show all unique tags across notes (sorted alphabetically). Clicking a tag chip SHALL filter the notes list client-side to notes with that tag. Clicking again or clicking "All" SHALL clear the filter. The tag bar SHALL wrap to multiple lines when tags exceed available width.

#### Scenario: Note card displays tags as chips
- **WHEN** a note with tags `["design", "todo"]` is rendered in the notes list
- **THEN** two chip components are visible on the note card showing "design" and "todo"

#### Scenario: Tag bar shows unique tags alphabetically
- **WHEN** notes exist with tags `["zoo"]`, `["apple"]`, `["design"]`
- **THEN** the tag bar displays "All", "apple", "design", "zoo" in that order

#### Scenario: Clicking tag chip filters notes client-side
- **WHEN** user clicks the "design" chip in the tag bar
- **THEN** only notes with "design" tag are shown in the list

#### Scenario: Clicking tag chip again clears filter
- **WHEN** user clicks the "design" chip while "design" is the active filter
- **THEN** the filter is cleared and all notes are shown

#### Scenario: Tag bar wraps when overflow
- **WHEN** there are many unique tags that exceed the tag bar width
- **THEN** tags wrap to multiple lines without truncation or scrolling

#### Scenario: Note without tags shows no chips
- **WHEN** a note has `tags = null`
- **THEN** no chips are displayed on the note card
