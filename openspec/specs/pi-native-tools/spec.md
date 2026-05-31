## ADDED Requirements

### Requirement: Complete tool set
The Pi engine exposes a complete set of Railyin-owned tools. All tool implementations are path-safe (no traversal outside worktree).

#### Scenario: Tool groups map to workflow YAML
- **WHEN** a workflow column config lists tool groups (e.g., `["read", "write", "search"]`)
- **THEN** `buildPiTools()` expands these to the corresponding `defineTool()` instances

### Requirement: read_file tool
Reads a file from the worktree. Supports optional line range.

#### Scenario: Full file read
- **WHEN** `read_file({ path: "src/auth.ts" })` is called
- **THEN** the full file content is returned as a string
- **AND** the content hash cache is updated for this path

#### Scenario: Partial file read
- **WHEN** `read_file({ path: "src/auth.ts", start_line: 10, end_line: 50 })` is called
- **THEN** only lines 10–50 are returned (1-based, inclusive)

#### Scenario: Path traversal blocked
- **WHEN** path resolves outside the worktree root
- **THEN** an error string `"Error: path traversal detected"` is returned

### Requirement: write_file tool
Creates or fully overwrites a file. Returns operationId for undo.

#### Scenario: Write new file
- **WHEN** `write_file({ path: "src/new.ts", content: "..." })` is called on a non-existent path
- **THEN** the file is created, a `FileDiffPayload` is produced, an undo snapshot is pushed, and the result includes `op:XXXX`

#### Scenario: Overwrite existing file
- **WHEN** `write_file` is called on an existing file
- **THEN** the pre-write content is saved in the undo stack, the file is overwritten, and `op:XXXX` is returned

### Requirement: patch_file tool
Makes a targeted anchor-based edit. Positions: `start`, `end`, `before`, `after`, `replace`.

#### Scenario: Anchor must be unique
- **WHEN** `patch_file` is called with an anchor that appears more than once in the file
- **THEN** an error `"Error: anchor appears N times"` is returned and no write occurs

#### Scenario: Patch produces undo snapshot
- **WHEN** a patch succeeds
- **THEN** the full pre-patch file content is stored in the undo stack with an `op:XXXX` id

### Requirement: delete_file tool
Deletes a file. The full file content is stored in the undo stack so deletion is reversible.

### Requirement: rename_file tool
Renames/moves a file within the worktree. Undo restores the original path.

### Requirement: undo_write tool
Reverts a previous write operation by `operationId` or by file path (most recent write to that path).

#### Scenario: Undo by operationId
- **WHEN** `undo_write({ operationId: "a3f9" })` is called
- **THEN** the file is restored to its pre-operation state

#### Scenario: Undo by path
- **WHEN** `undo_write({ path: "src/auth.ts" })` is called
- **THEN** the most recent write operation on that path is reverted

#### Scenario: operationId not found
- **WHEN** an operationId has been evicted from the stack (cap exceeded)
- **THEN** `"Error: op:XXXX is no longer in the undo history (stack limit reached)"` is returned

### Requirement: list_dir tool
Lists files and directories at a path. Returns sorted relative paths; directories suffixed with `/`.

### Requirement: search_text tool
Searches for a regex/string pattern across worktree files. Supports glob filter and context lines.

### Requirement: run_command tool
Runs a free-form shell command in the worktree directory for read/inspect purposes.

#### Scenario: Tool description enforces read-only usage
- **WHEN** the tool description is read by the model
- **THEN** it contains explicit NEVER instructions: "NEVER use run_command to write or edit files — use write_file and patch_file instead"

#### Scenario: No server-side denylist
- **WHEN** any shell command is submitted
- **THEN** it is executed as-is (no blocked-command regex applied) — safety is description-only

### Requirement: fetch_url tool
Fetches a public URL and returns plain text (HTML stripped). V1 implementation — improvement deferred to task #384.

### Requirement: search_internet tool
Searches the web via configured provider (Tavily). V1 implementation — improvement deferred to task #384.

### Requirement: Board tools
All common-tools (`get_task`, `list_tasks`, `create_task`, `edit_task`, `delete_task`, `move_task`, `message_task`, `get_board_summary`) are wrapped as Pi `defineTool()` instances and injected when `board` group is in the column config.

### Requirement: Tool description language
Every tool description uses imperative NEVER/ALWAYS language targeting LLMs, not humans. Descriptions state what to do and not do, not how the tool works internally.
