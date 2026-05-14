## ADDED Requirements

### Requirement: Session reuse preserves SDK built-in tools
The test suite SHALL verify that SDK built-in tools (`read`, `grep`, `find`, `ls`) remain available on every turn, including turn 2 and beyond, when a Pi session is reused.

#### Scenario: setActiveToolsByName called on turn 2
- **WHEN** a `PiEngine` executes a second turn for the same `conversationId`
- **THEN** `session.setActiveToolsByName()` is invoked with a names list that includes all SDK built-in tool names

#### Scenario: SDK built-in names included in reuse call
- **WHEN** `setActiveToolsByName()` is called during session reuse
- **THEN** the names list includes `"read"`, `"grep"`, `"find"`, and `"ls"`

### Requirement: commonCtxRefs map lifecycle is correct
The test suite SHALL verify that `PiEngine` stores one `CommonToolContext` per conversation and mutates it in-place on subsequent executions.

#### Scenario: commonCtxRef created on first execution
- **WHEN** `PiEngine` executes for a given `conversationId` for the first time
- **THEN** a `CommonToolContext` ref is created and keyed by that `conversationId`

#### Scenario: commonCtxRef mutated on second execution
- **WHEN** `PiEngine` executes for the same `conversationId` a second time
- **THEN** the existing `CommonToolContext` ref has its `runtime.worktreePath` updated to the new working directory

### Requirement: run_command description contains no ghost tool references
The test suite SHALL verify that the `run_command` tool description does not reference `search_text` or any other removed tool.

#### Scenario: search_text absent from run_command description
- **WHEN** `buildAllTools()` is called with the `shell` column group
- **THEN** the `run_command` tool's description does NOT contain the string `"search_text"`

#### Scenario: grep and find referenced in run_command description
- **WHEN** `buildAllTools()` is called with the `shell` column group
- **THEN** the `run_command` tool's description contains `"grep"` or `"find"`

### Requirement: Stale tool names absent from context constants
The test suite SHALL verify that `MICRO_COMPACT_CLEARABLE_TOOLS` and `TOOL_RESULT_LIMITS` contain no entries for removed tools (`search_text`, `find_files`).

#### Scenario: search_text absent from MICRO_COMPACT_CLEARABLE_TOOLS
- **WHEN** `MICRO_COMPACT_CLEARABLE_TOOLS` is imported from `conversation/context.ts`
- **THEN** it does NOT contain `"search_text"`

#### Scenario: find_files absent from MICRO_COMPACT_CLEARABLE_TOOLS
- **WHEN** `MICRO_COMPACT_CLEARABLE_TOOLS` is imported from `conversation/context.ts`
- **THEN** it does NOT contain `"find_files"`

#### Scenario: search_text absent from TOOL_RESULT_LIMITS
- **WHEN** `TOOL_RESULT_LIMITS` is imported from `conversation/context.ts`
- **THEN** it does NOT have an entry keyed by `"search_text"`

#### Scenario: find_files absent from TOOL_RESULT_LIMITS
- **WHEN** `TOOL_RESULT_LIMITS` is imported from `conversation/context.ts`
- **THEN** it does NOT have an entry keyed by `"find_files"`

### Requirement: buildPiToolDisplay handles SDK built-in tools correctly
The test suite SHALL verify that `buildPiToolDisplay` returns correct display metadata for each SDK built-in tool name and that `search_text` produces no Pi-specific label.

#### Scenario: read tool display
- **WHEN** `buildPiToolDisplay("read", { file_path: "/repo/src/a.ts" })` is called
- **THEN** the result has `label: "read"`, `contentType: "file"`, and a relative `subject`

#### Scenario: grep tool display
- **WHEN** `buildPiToolDisplay("grep", { pattern: "myFunc" })` is called
- **THEN** the result has `label: "grep"` and `contentType: "terminal"`

#### Scenario: find tool display
- **WHEN** `buildPiToolDisplay("find", { pattern: "*.ts" })` is called
- **THEN** the result has `label: "find"` and `contentType: "terminal"`

#### Scenario: ls tool display
- **WHEN** `buildPiToolDisplay("ls", { path: "/repo/src" })` is called
- **THEN** the result has `label: "ls"` and `contentType: "terminal"`

#### Scenario: search_text falls to default display
- **WHEN** `buildPiToolDisplay("search_text", { pattern: "test" })` is called
- **THEN** the result is produced by `buildCommonToolDisplay` (no Pi-specific label override)
