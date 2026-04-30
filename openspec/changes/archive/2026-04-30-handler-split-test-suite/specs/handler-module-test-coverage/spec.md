## ADDED Requirements

### Requirement: transition-validator has unit test coverage
`src/bun/test/transition-validator.test.ts` SHALL exist and cover all observable behaviors of `validateTransition(db, taskId, toState)`.

#### Scenario: TV-1 — task not found returns ok:false
- **WHEN** `validateTransition` is called with a `taskId` that does not exist in the database
- **THEN** it returns `{ ok: false, reason: <string> }` without throwing

#### Scenario: TV-2 — invalid toState returns ok:false with valid column list
- **WHEN** `validateTransition` is called with a `toState` that is not a column in the workflow template
- **THEN** it returns `{ ok: false, reason: <string> }` where `reason` names valid column IDs

#### Scenario: TV-3 — destination column at capacity returns ok:false
- **WHEN** the destination column has a `limit` equal to its current task count
- **THEN** `validateTransition` returns `{ ok: false, reason: <string> }` describing the capacity constraint

#### Scenario: TV-4 — source column has allowed_transitions, target not in list
- **WHEN** the source column declares `allowed_transitions: [col-a]` and `toState` is a different valid column
- **THEN** `validateTransition` returns `{ ok: false, reason: <string> }`

#### Scenario: TV-5 — free source (no allowed_transitions) always permits
- **WHEN** the source column has no `allowed_transitions` field
- **THEN** `validateTransition` returns `{ ok: true, ... }` for any valid destination

#### Scenario: TV-6 — target is in allowed_transitions list
- **WHEN** the source column declares `allowed_transitions: [col-a]` and `toState` is `col-a`
- **THEN** `validateTransition` returns `{ ok: true, ... }`

#### Scenario: TV-7 — success result carries boardId, fromCol, toCol
- **WHEN** `validateTransition` returns `ok: true`
- **THEN** the result object contains `boardId`, `fromCol`, and `toCol` fields with correct values

### Requirement: diff-utils has unit test coverage
`src/bun/test/diff-utils.test.ts` SHALL exist and cover all four exported functions in `src/bun/git/diff-utils.ts`.

#### Scenario: DU-1 — parseGitDiffHunks single hunk
- **WHEN** a diff string with one `@@` header is parsed
- **THEN** exactly one `ParsedHunk` is returned with correct `oldStart`, `oldCount`, `newStart`, `newCount`, and `hunkIndex: 0`

#### Scenario: DU-2 — parseGitDiffHunks two hunks
- **WHEN** a diff string with two `@@` headers is parsed
- **THEN** two `ParsedHunk` entries are returned with `hunkIndex` 0 and 1 respectively

#### Scenario: DU-3 — parseGitDiffHunks pure addition hunk
- **WHEN** the diff hunk contains only `+` lines (no `-` lines)
- **THEN** the parsed hunk has `oldCount: 0` and correct `newCount`

#### Scenario: DU-4 — parseGitDiffHunks pure deletion hunk
- **WHEN** the diff hunk contains only `-` lines (no `+` lines)
- **THEN** the parsed hunk has `newCount: 0` and correct `oldCount`

#### Scenario: DU-5 — computeHunkHash is deterministic
- **WHEN** `computeHunkHash` is called twice with identical file path, old start, and content
- **THEN** both calls return the same SHA-256 hex string

#### Scenario: DU-6 — computeHunkHash differs on content change
- **WHEN** `computeHunkHash` is called with different content values
- **THEN** the two hash values are not equal

#### Scenario: DU-7 — extractHunkPatch returns hunk 0
- **WHEN** `extractHunkPatch` is called with `hunkIndex: 0` on a valid diff string
- **THEN** it returns a string starting with `@@` for the first hunk

#### Scenario: DU-8 — extractHunkPatch returns hunk 1 from multi-hunk diff
- **WHEN** `extractHunkPatch` is called with `hunkIndex: 1` on a two-hunk diff
- **THEN** it returns the `@@` block for the second hunk only

#### Scenario: DU-9 — extractHunkPatch throws on out-of-range index
- **WHEN** `extractHunkPatch` is called with an index ≥ the number of hunks
- **THEN** it throws an `Error`

#### Scenario: DU-10 — readFileDiffContent on modified file
- **WHEN** a committed file is modified and `readFileDiffContent` is called for that file
- **THEN** the result has non-empty `original`, non-empty `modified`, and at least one entry in `hunks`

#### Scenario: DU-11 — readFileDiffContent on new untracked file
- **WHEN** a new file is added (not yet committed) and `readFileDiffContent` is called
- **THEN** `original` is empty string, `modified` contains the file content, and `hunks` is non-empty

#### Scenario: DU-12 — readFileDiffContent on deleted file
- **WHEN** a committed file is deleted and `readFileDiffContent` is called
- **THEN** `original` contains the file content, `modified` is empty string

### Requirement: todoHandlers has unit test coverage
`src/bun/test/todo-handlers.test.ts` SHALL exist and cover `todoHandlers(db)` via `TodoRepository`.

#### Scenario: TH-1 — todos.create inserts and returns new TodoListItem
- **WHEN** `todos.create` is called with valid taskId, number, title, description
- **THEN** a `TodoListItem` is returned with `status: "pending"` and the provided fields

#### Scenario: TH-2 — todos.list returns non-deleted todos by default
- **WHEN** `todos.list` is called with `includeDeleted: false`
- **THEN** only todos with status not equal to `"deleted"` are returned

#### Scenario: TH-3 — todos.list with includeDeleted returns deleted todos
- **WHEN** `todos.list` is called with `includeDeleted: true`
- **THEN** todos with `status: "deleted"` are also included in the result

#### Scenario: TH-4 — todos.get returns full TodoItem for existing todo
- **WHEN** `todos.get` is called with a valid taskId and todoId
- **THEN** a `TodoItem` with all fields is returned

#### Scenario: TH-5 — todos.get returns deleted sentinel for deleted todo
- **WHEN** `todos.get` is called for a soft-deleted todo
- **THEN** the result is `{ deleted: true, message: <string> }` (not null, not a full item)

#### Scenario: TH-6 — todos.get returns null for non-existent todo
- **WHEN** `todos.get` is called with a todoId that does not exist
- **THEN** the result is `null`

#### Scenario: TH-7 — todos.edit updates title and description
- **WHEN** `todos.edit` is called with new title and description on a pending todo
- **THEN** the returned item reflects the updated values

#### Scenario: TH-8 — todos.edit returns error for non-existent todo
- **WHEN** `todos.edit` is called with a todoId that does not exist
- **THEN** the result is `{ error: <string> }`

#### Scenario: TH-9 — todos.edit returns error for deleted todo
- **WHEN** `todos.edit` is called on a soft-deleted todo
- **THEN** the result is `{ error: <string> }`

#### Scenario: TH-10 — todos.delete soft-deletes and returns updated item
- **WHEN** `todos.delete` is called for an existing todo
- **THEN** the todo's status is set to `"deleted"` and the returned item reflects this

### Requirement: codeReviewHandlers has unit test coverage
`src/bun/test/code-review-handlers.test.ts` SHALL exist and cover `codeReviewHandlers(db)`.

#### Scenario: CR-1 — getFileDiff returns hunk list for modified file
- **WHEN** `tasks.getFileDiff` is called for a file with uncommitted changes in the task's worktree
- **THEN** the result contains at least one hunk with a computed hash and decision field

#### Scenario: CR-2 — setHunkDecision persists accepted decision
- **WHEN** `tasks.setHunkDecision` is called with `decision: "accepted"` and a valid hash
- **THEN** subsequent `getFileDiff` returns that hunk with `decision: "accepted"`

#### Scenario: CR-3 — decideAllHunks sets all hunks to one decision
- **WHEN** `tasks.decideAllHunks` is called with `decision: "accepted"` for a file with multiple hunks
- **THEN** all hunks for that file are returned with `decision: "accepted"` by `getFileDiff`

#### Scenario: CR-4 — rejectHunk marks hunk as rejected
- **WHEN** `tasks.rejectHunk` is called with a valid hunk hash
- **THEN** subsequent `getFileDiff` returns that hunk with `decision: "rejected"`

#### Scenario: CR-5 — addLineComment and getLineComments round-trip
- **WHEN** `tasks.addLineComment` is called with a file path, line number, and body
- **THEN** `tasks.getLineComments` for that file returns a list including the new comment

#### Scenario: CR-6 — deleteLineComment removes the comment
- **WHEN** `tasks.deleteLineComment` is called with a valid comment ID
- **THEN** `tasks.getLineComments` no longer includes that comment

#### Scenario: CR-7 — getPendingHunkSummary counts undecided hunks
- **WHEN** `tasks.getPendingHunkSummary` is called for a task with two hunks of which one is decided
- **THEN** the result reports one pending hunk

### Requirement: taskGitHandlers has unit test coverage
`src/bun/test/task-git-handlers.test.ts` SHALL exist and cover `taskGitHandlers(db, onTaskUpdated)`.

#### Scenario: TG-1 — tasks.listBranches returns branch list
- **WHEN** `tasks.listBranches` is called for a task with a registered git context
- **THEN** the result contains at least one branch name (e.g., `"main"` or `"master"`)

#### Scenario: TG-2 — tasks.createWorktree creates worktree and returns updated task
- **WHEN** `tasks.createWorktree` is called with a valid path and branch name
- **THEN** the worktree directory is created on disk and the returned `Task` reflects the updated worktree state

#### Scenario: TG-3 — tasks.getChangedFiles returns modified file paths
- **WHEN** a file is modified in the task's worktree and `tasks.getChangedFiles` is called
- **THEN** the result array includes the modified file's path

### Requirement: modelHandlers has unit test coverage
`src/bun/test/model-handlers.test.ts` SHALL exist and cover `modelHandlers(db, orchestrator)`.

#### Scenario: MH-1 — models.list returns model list from orchestrator
- **WHEN** `models.list` is called and the orchestrator returns a provider model list
- **THEN** the result matches the orchestrator's return value

#### Scenario: MH-2 — models.setEnabled persists the enabled flag
- **WHEN** `models.setEnabled` is called with `{ modelId: "x", enabled: true }`
- **THEN** the database row for that model has `enabled = 1` and the handler returns successfully

#### Scenario: MH-3 — models.listEnabled returns only enabled models
- **WHEN** `models.listEnabled` is called after enabling model "x" and disabling model "y"
- **THEN** the result includes "x" and excludes "y"

### Requirement: engineHandlers has unit test coverage
`src/bun/test/engine-handlers.test.ts` SHALL exist and cover `engineHandlers(orchestrator)`.

#### Scenario: EH-1 — engine.listCommands returns command list from orchestrator
- **WHEN** `engine.listCommands` is called with a task ID and a mock orchestrator that returns commands
- **THEN** the handler returns the orchestrator's command list

#### Scenario: EH-2 — engine.listCommands with null orchestrator returns empty array
- **WHEN** `engine.listCommands` is called with `orchestrator: null`
- **THEN** the handler returns an empty array without throwing
