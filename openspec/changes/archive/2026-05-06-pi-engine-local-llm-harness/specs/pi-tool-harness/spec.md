## ADDED Requirements

### Requirement: Pi tool harness provides the full native tool set via Pi defineTool
The system SHALL provide a `buildPiTools(commonCtx, harnessCtx, columnGroups?)` function at `src/bun/engine/pi/tools/index.ts` that returns an array of Pi `defineTool`-compatible tool definitions. The harness SHALL include: `read_file`, `glob`, `write_file`, `patch_file`, `delete_file`, `rename_file`, `undo_write`, `search_text`, `run_command`, `fetch_url`, `search_internet`, and all tools from `common-tools.ts` (board + ask_user). `glob(pattern, type?, limit?, offset?)` replaces both `find_files` and `list_dir` from the old native engine — `type` accepts `"file"|"dir"|"any"` (default `"file"`), `limit` defaults to 100, `offset` enables pagination. All tool descriptions SHALL follow the NEVER/ALWAYS imperative pattern: prescriptive, LLM-targeted, describing correct usage rather than internal mechanics.

#### Scenario: All tools are returned as Pi-compatible definitions
- **WHEN** `buildPiTools(ctx, harnessCtx)` is called
- **THEN** the returned array contains all Railyin harness tools as `defineTool` objects consumable by `createAgentSession({ customTools: [...] })`

#### Scenario: read_file description includes unchanged-marker instruction
- **WHEN** the model receives the `read_file` tool definition
- **THEN** the description includes guidance that `[unchanged since last read]` means the cached version is current and the model MUST NOT call read_file again for the same file

#### Scenario: write_file description includes undo instruction
- **WHEN** the model receives the `write_file` tool definition
- **THEN** the description instructs the model to save the `op:XXXX` from the result and pass it to `undo_write` if it needs to revert

#### Scenario: run_command description prohibits file writes
- **WHEN** the model receives the `run_command` tool definition
- **THEN** the description contains a NEVER clause prohibiting use of `run_command` to write or edit files, and directs the model to use `write_file` and `patch_file` instead

### Requirement: Pi harness tools are path-safe and confined to worktreePath
All file-operating tools in the harness SHALL resolve paths relative to `harnessCtx.worktreePath`. Any path that resolves outside the worktree root SHALL be rejected with an error string. This applies to `read_file`, `glob`, `write_file`, `patch_file`, `delete_file`, `rename_file`.

#### Scenario: Path traversal is rejected
- **WHEN** any file tool is called with a path like `../../etc/passwd`
- **THEN** the tool returns `"Error: path traversal detected — path must be inside the worktree"` and no filesystem operation is performed

### Requirement: Pi tool groups are configurable per workflow column
The system SHALL register Pi tool groups (`read`, `write`, `search`, `shell`, `web`, `board`, `interactions`) in a `PI_TOOL_GROUPS` map within the Pi tools module. When a workflow column's `tools:` array is provided, `buildPiTools` SHALL include only the tools belonging to the listed groups. This follows the identical pattern as the old native `TOOL_GROUPS` map.

#### Scenario: Column configured with read+search groups gets only those tools
- **WHEN** a column has `tools: ["read", "search"]` and the Pi engine builds tools for an execution
- **THEN** `buildPiTools` returns only `read_file`, `glob`, `search_text` (plus board/interaction tools from common-tools which are always included)

#### Scenario: Column with no tools config gets full default tool set
- **WHEN** a column has no `tools:` config
- **THEN** `buildPiTools` returns the default tool set: `read`, `write`, `search`, `shell`

### Requirement: run_command executes in worktreePath with free-form shell string
The system SHALL provide a `run_command` tool that accepts `{ command: string }` and executes it via `sh -c <command>` with `cwd` set to `harnessCtx.worktreePath`. Output SHALL be capped at 8KB (stdout) + 2KB (stderr). Execution timeout SHALL be 15 seconds.

#### Scenario: Command runs in worktree directory
- **WHEN** `run_command({ command: "git log --oneline -5" })` is called
- **THEN** the command runs with cwd set to the task's worktreePath and returns stdout output

#### Scenario: Long output is truncated
- **WHEN** command output exceeds 8KB
- **THEN** only the first 8KB is returned, appended with `"\n[truncated]"`
