## MODIFIED Requirements

### Requirement: Shell command execution extracts all binaries before approval check
Before executing any shell command, the system SHALL parse the full command string to extract a deduplicated list of command binaries. Extraction SHALL split the command on shell meta-characters (`&&`, `||`, `;`, and `|`). Pipe characters (`|`) SHALL be treated as command boundaries — every segment of a pipeline, including receivers, requires approval. The resulting list is passed to the approval gate. The extraction function SHALL be engine-agnostic and located in `engine/approved-commands.ts` as `parseShellBinaries`, available to all engines.

#### Scenario: Single command binary extracted
- **WHEN** the agent calls `run_command` with `git status`
- **THEN** the extracted binary list is `["git"]`

#### Scenario: Compound command binaries extracted
- **WHEN** the agent calls `run_command` with `cd src && bun test && git diff`
- **THEN** the extracted binary list is `["cd", "bun", "git"]`

#### Scenario: Duplicate binaries deduplicated
- **WHEN** the agent calls `run_command` with `git add . && git commit -m "msg"`
- **THEN** the extracted binary list is `["git"]` (deduplicated)

#### Scenario: Pipe receiver IS extracted and requires approval
- **WHEN** the agent calls `run_command` with `bun test | cat`
- **THEN** the extracted binary list is `["bun", "cat"]` — `cat` is a pipe receiver and SHALL require approval

#### Scenario: Multiple pipe receivers are all extracted
- **WHEN** the agent calls `run_command` with `ls -la | grep ts | wc -l`
- **THEN** the extracted binary list is `["ls", "grep", "wc"]`

#### Scenario: Mixed shell meta-characters all split correctly
- **WHEN** the agent calls `run_command` with `git status && bun test | cat`
- **THEN** the extracted binary list is `["git", "bun", "cat"]`
