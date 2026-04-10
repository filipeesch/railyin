## ADDED Requirements

### Requirement: Reviewer can add a single-line comment via glyph margin
In review mode, the Monaco DiffEditor SHALL display a clickable `+` glyph icon in the gutter when the reviewer hovers over any line of the modified file. Clicking the icon SHALL open a `LineCommentBar` ViewZone directly below that line containing a textarea and Cancel / Post buttons.

#### Scenario: Glyph appears on hover
- **WHEN** the reviewer hovers over any line in the modified editor in review mode
- **THEN** a `+` glyph icon appears in the glyph margin of that line

#### Scenario: Clicking glyph opens comment form
- **WHEN** the reviewer clicks the `+` glyph icon on a line
- **THEN** a `LineCommentBar` ViewZone is injected below that line with a focused textarea and Cancel / Post buttons

#### Scenario: Glyph is not shown in changes mode
- **WHEN** the overlay is in changes mode (not review mode)
- **THEN** no glyph icons appear in the gutter

### Requirement: Reviewer can add a range comment via selection ContentWidget
In review mode, when the reviewer selects a range spanning two or more lines in the modified editor, the system SHALL display a "Add comment" ContentWidget at the end of the selection. Clicking it SHALL open a `LineCommentBar` ViewZone spanning the full selected line range.

#### Scenario: ContentWidget appears for multi-line selection
- **WHEN** the reviewer selects two or more lines in the modified editor in review mode
- **THEN** an "Add comment" ContentWidget appears at the end of the selection

#### Scenario: ContentWidget not shown for single-line selection
- **WHEN** the reviewer selects text within a single line
- **THEN** no ContentWidget appears

#### Scenario: Clicking ContentWidget opens range comment form
- **WHEN** the reviewer clicks the "Add comment" ContentWidget
- **THEN** a `LineCommentBar` ViewZone is injected spanning the selected lines

### Requirement: LineCommentBar has open and posted states
The `LineCommentBar` ViewZone component SHALL support two visual states:
- `open`: textarea with Cancel and Post buttons; Post is disabled when textarea is empty
- `posted`: read-only display of the comment text and a Delete button

#### Scenario: Post button disabled when textarea is empty
- **WHEN** the `LineCommentBar` is open and the textarea contains only whitespace
- **THEN** the Post button is disabled

#### Scenario: Posting a comment transitions to posted state
- **WHEN** the reviewer enters text and clicks Post
- **THEN** the ViewZone transitions to the `posted` state displaying the comment text and a Delete button
- **AND** the comment is persisted via `tasks.addLineComment`

#### Scenario: Cancel removes the open form
- **WHEN** the reviewer clicks Cancel in the open state
- **THEN** the `LineCommentBar` ViewZone is removed from the editor with no comment saved

#### Scenario: Delete removes a posted comment
- **WHEN** the reviewer clicks Delete on a posted comment
- **THEN** the ViewZone is removed and the comment is deleted via `tasks.deleteLineComment`

### Requirement: Line comments are independent of hunk decisions
Line comments SHALL be stored in a separate `task_line_comments` table. A line comment MAY be placed on any line of the modified file, including lines that are not part of any diff hunk. The presence or absence of a hunk decision on a hunk SHALL NOT affect whether a line comment can be placed on lines within that hunk.

#### Scenario: Comment on a non-diff line
- **WHEN** the reviewer adds a comment on a line that is context (not highlighted as changed)
- **THEN** the comment is accepted and the ViewZone is placed on that line

#### Scenario: Comment on a changed line alongside a hunk decision
- **WHEN** the reviewer has accepted a hunk and also adds a line comment on one of the hunk's lines
- **THEN** both the hunk decision and the line comment appear in the submit payload

### Requirement: Line comments use `sent` boolean lifecycle
Line comments SHALL use a `sent INTEGER DEFAULT 0` column. On submit, all unsent line comments for the task SHALL be marked as `sent = 1`. When the overlay opens for a new review round, only comments where `sent = 0` are loaded and rendered. Prior-round (sent) comments are not shown.

#### Scenario: Comments marked as sent on submit
- **WHEN** the reviewer submits a review with active line comments
- **THEN** all line comments with `sent = 0` for the task are updated to `sent = 1`

#### Scenario: Sent comments not shown in next review round
- **WHEN** the reviewer submits a review and the model responds and the overlay is reopened
- **THEN** no line comments from the previous round are rendered

#### Scenario: Unsaved comment form discarded on submit
- **WHEN** the reviewer has an open (unposted) comment form and clicks Submit Review
- **THEN** the open form is discarded and not included in the payload

### Requirement: Line comments support future AI-authored comments
The `task_line_comments` table SHALL include `reviewer_id TEXT NOT NULL DEFAULT 'user'` and `reviewer_type TEXT NOT NULL DEFAULT 'human'` columns. The current UI and IPC layer always writes `reviewer_id = 'user'` and `reviewer_type = 'human'`. No AI comment generation is implemented in this change, but the schema is ready.

#### Scenario: Human reviewer comment stored with correct reviewer columns
- **WHEN** a human reviewer posts a line comment
- **THEN** the stored row has `reviewer_id = 'user'` and `reviewer_type = 'human'`

### Requirement: UI tests cover all line-comment scenarios
The test suite SHALL include UI tests for: adding a single-line comment, adding a range comment, cancelling a comment form, deleting a posted comment, submit payload including line comments, and second-round fresh-slate behavior.

#### Scenario: Single-line comment test
- **WHEN** the UI test triggers a glyph click on a specific line and posts a comment
- **THEN** the posted comment ViewZone is visible and the IPC call is verified

#### Scenario: Range comment test
- **WHEN** the UI test simulates a multi-line selection and clicks the ContentWidget
- **THEN** the range comment form opens for the correct line range

#### Scenario: Submit payload includes line comments
- **WHEN** the UI test submits a review with active line comments
- **THEN** the captured submit payload contains `lineComments` for the relevant file

#### Scenario: Second-round fresh slate
- **WHEN** the UI test submits and reopens the overlay
- **THEN** no line comments from the prior round are rendered
