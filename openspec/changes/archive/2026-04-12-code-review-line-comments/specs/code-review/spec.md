## MODIFIED Requirements

### Requirement: Decided hunks are shown with decorations instead of collapsing
When a reviewer accepts or rejects a hunk, the system SHALL NOT rebuild the Monaco display model. Instead, the system SHALL apply `deltaDecorations` to visually mark decided hunks:
- Accepted hunks: green tint decoration on the modified-side lines
- Rejected hunks: strikethrough + muted color decoration on the modified-side lines (transient — the file is reverted on disk, so these lines disappear on next diff reload)

The full `original` vs `modified` diff SHALL be shown at all times. Line numbers SHALL remain stable after any hunk decision.

#### Scenario: Accept applies decoration without model rebuild
- **WHEN** a reviewer accepts a hunk
- **THEN** the hunk's lines in the modified editor are decorated with a green tint
- **AND** the Monaco model is NOT rebuilt
- **AND** all ViewZone positions and line numbers remain unchanged

#### Scenario: Reject applies decoration and reloads diff
- **WHEN** a reviewer rejects a hunk
- **THEN** the file is reverted on disk and the diff is reloaded from the backend
- **AND** the diff reflects the reverted file content

#### Scenario: Multiple decided hunks show their decorations simultaneously
- **WHEN** a reviewer has accepted some hunks and rejected others
- **THEN** all decided hunks show their respective decorations (green tint or strikethrough) simultaneously in the diff

### Requirement: Hunk decisions use `sent` boolean lifecycle
The `task_hunk_decisions` table SHALL have a `sent INTEGER NOT NULL DEFAULT 0` column. On submit, all unsent hunk decisions (`sent = 0`) SHALL be included in the LLM payload and then marked as `sent = 1`. The LLM SHALL only receive decisions from the current (unsent) round.

#### Scenario: Only unsent decisions included in LLM payload
- **WHEN** a reviewer submits with both sent and unsent hunk decisions in the database
- **THEN** the LLM message only includes hunk decisions where `sent = 0`

#### Scenario: Decisions marked as sent after submit
- **WHEN** a reviewer submits a review
- **THEN** all hunk decisions with `sent = 0` for the task are updated to `sent = 1`

### Requirement: Submit sends structured code_review message to the model
The system SHALL provide a Submit Review button in the overlay (visible only in Review mode). On submit, the system SHALL:
1. Send `{ _type: "code_review" }` via `tasks.sendMessage` — no payload in the envelope
2. The backend reads all unsent (`sent = 0`) human decisions from `task_hunk_decisions` and all unsent (`sent = 0`) line comments from `task_line_comments` and builds the `CodeReviewPayload`
3. Each `CodeReviewHunk` in the payload SHALL include `originalLines: string[]` and `modifiedLines: string[]` containing the actual diff content so the model has full context
4. Each `CodeReviewFile` in the payload SHALL include `lineComments: LineComment[]` containing all unsent line comments for that file, each with `lineText`, `contextLines`, and `comment` fields
5. Create a `"code_review"` ConversationMessage with JSON content containing the full decision set
6. Inject a plain-text user-role message to the LLM formatted as annotated diff blocks per file (hunk diffs + line comments inline)
7. Trigger a new execution in the task's current column with its existing toolset
8. Close the review overlay
9. Mark all submitted hunk decisions and line comments as `sent = 1`

Undecided (`pending`) hunks on submit SHALL be treated as implicitly accepted and SHALL NOT appear in the submit message.

#### Scenario: Submit includes hunk diff content
- **WHEN** a reviewer rejects a hunk and submits
- **THEN** the LLM message includes the original and modified lines of that hunk as a mini-diff block

#### Scenario: Submit includes line comments with context
- **WHEN** a reviewer has posted line comments and submits
- **THEN** the LLM message includes an annotated diff block per comment showing the commented lines and ±3 surrounding context lines

#### Scenario: Submit marks all items as sent
- **WHEN** the reviewer submits a review
- **THEN** all unsent hunk decisions and line comments for the task are marked with `sent = 1`
- **AND** reopening the overlay for a new review round shows no prior-round line comments

#### Scenario: Submit includes correct hunk ranges
- **WHEN** the reviewer submits a review with hunk decisions
- **THEN** each `CodeReviewHunk` in the payload has correct `originalRange` and `modifiedRange` with both start and end values
