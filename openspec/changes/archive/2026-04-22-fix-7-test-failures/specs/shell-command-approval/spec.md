## MODIFIED Requirements

### Requirement: run_command extracts command binaries before execution
Before executing any `run_command` call, the system SHALL parse the full command string to extract a deduplicated list of command binaries. Extraction SHALL split the command on shell meta-characters (`&&`, `||`, `;`) only. Bare pipe (`|`) SHALL NOT be treated as a binary boundary — only the left-hand side command of a pipeline is the "initiating command". The resulting list is passed to the approval gate.

#### Scenario: Single command binary extracted
- **WHEN** the agent calls `run_command` with `git status`
- **THEN** the extracted binary list is `["git"]`

#### Scenario: Compound command binaries extracted
- **WHEN** the agent calls `run_command` with `cd src && bun test && git diff`
- **THEN** the extracted binary list is `["cd", "bun", "git"]`

#### Scenario: Duplicate binaries deduplicated
- **WHEN** the agent calls `run_command` with `git add . && git commit -m "msg"`
- **THEN** the extracted binary list is `["git"]` (deduplicated)

#### Scenario: Pipe receiver is NOT extracted as a separate binary
- **WHEN** the agent calls `run_command` with `bun test | cat`
- **THEN** the extracted binary list is `["bun"]` — `cat` is a pipe receiver, not the initiating command, and SHALL NOT require approval

#### Scenario: Multiple pipe receivers are all excluded
- **WHEN** the agent calls `run_command` with `ls -la | grep ts | wc -l`
- **THEN** the extracted binary list is `["ls"]`
