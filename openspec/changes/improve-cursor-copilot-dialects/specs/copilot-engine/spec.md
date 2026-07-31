## MODIFIED Requirements

### Requirement: CopilotEngine resolves projectPath and scans .github/instructions/
The system SHALL resolve projectPath from the database in `CopilotEngine._run()` using the same pattern as `listCommands()`. The engine SHALL scan `.github/instructions/` at both projectPath and worktreePath for `.md` files, parse frontmatter, and inject instruction blocks into the system message via `systemMessage: { mode: "append" }`.

#### Scenario: ProjectPath resolved from DB
- **WHEN** `CopilotEngine._run()` is called for a task with a project that has `projectPath` different from `worktree_path`
- **THEN** the engine resolves `projectPath` from the database
- **AND** uses it to scan `.github/instructions/` at both projectPath and worktreePath

#### Scenario: Instruction files scanned at project root
- **WHEN** `<projectPath>/.github/instructions/conventions.md` exists with frontmatter
- **THEN** the file is scanned and included in the instruction blocks
- **AND** frontmatter is parsed for `description` and `autoApply` fields
- **AND** if `autoApply: true`, full file content is included; otherwise only frontmatter

#### Scenario: Instruction files scanned at worktree root
- **WHEN** `<worktreePath>/.github/instructions/testing.md` exists with frontmatter
- **AND** `worktreePath` differs from `projectPath`
- **THEN** the file is scanned and included in the instruction blocks
- **AND** deduplicated by name (projectPath version wins if same name exists in both)

#### Scenario: Instructions injected via systemMessage append
- **WHEN** instruction files are found and parsed
- **THEN** the instruction blocks are formatted as markdown (e.g., `### conventions\n\n**Project conventions**\n\ncontent`)
- **AND** appended to the systemContent before passing to `systemMessage: { mode: "append", content }`
- **AND** the SDK receives the instructions as part of the system message

#### Scenario: No instructions found
- **WHEN** no `.github/instructions/` directory exists at projectPath or worktreePath
- **THEN** no instruction blocks are added to the systemContent
- **AND** the system message is constructed without instruction content

#### Scenario: Files without frontmatter are skipped
- **WHEN** a `.md` file in `.github/instructions/` has no YAML frontmatter
- **THEN** the file is silently skipped
- **AND** no error is thrown
- **AND** the file is not included in the system prompt

### Requirement: CopilotEngine logs instruction loading
The system SHALL log a structured JSON line when instruction files are loaded by the Copilot engine. The log SHALL include event type, engine name, count of instructions loaded, and file paths.

#### Scenario: Instructions loaded log emitted
- **WHEN** instruction files are found and parsed
- **THEN** a JSON log line is emitted with format: `{"event": "instructions_loaded", "engine": "copilot", "count": N, "files": ["path1", "path2"]}`
