## MODIFIED Requirements

### Requirement: PiDialectResolver provides getInstructions() method
The system SHALL add a `getInstructions(cwd: string, gitWorktreeRootPath: string): Instruction[]` method to `PiDialectResolver`. The method SHALL scan instruction files based on the configured dialect convention. The method SHALL return an `Instruction[]` array with files from both project root (cwd) and worktree root (if different).

#### Scenario: Copilot dialect scans .github/instructions/
- **WHEN** `PiDialectResolver` is configured with `CopilotDialect`
- **AND** `getInstructions(cwd, gitWorktreeRootPath)` is called
- **THEN** it scans `<cwd>/.github/instructions/` and `<gitWorktreeRootPath>/.github/instructions/`
- **AND** returns `Instruction[]` with parsed frontmatter from `.md` files
- **AND** projectPath (cwd) files have higher priority (deduplicated by name)

#### Scenario: Cursor dialect scans .cursor/rules/
- **WHEN** `PiDialectResolver` is configured with `CursorDialect`
- **AND** `getInstructions(cwd, gitWorktreeRootPath)` is called
- **THEN** it scans `<cwd>/.cursor/rules/` and `<gitWorktreeRootPath>/.cursor/rules/`
- **AND** returns `Instruction[]` with parsed frontmatter from `.mdc` and `.md` files
- **AND** projectPath (cwd) files have higher priority (deduplicated by name)

#### Scenario: Unknown dialect returns empty array
- **WHEN** `PiDialectResolver` is configured with an unknown dialect (e.g., `NullDialect`)
- **AND** `getInstructions(cwd, gitWorktreeRootPath)` is called
- **THEN** it returns `[]`
- **AND** no error is thrown

#### Scenario: Files without frontmatter are skipped
- **WHEN** a file in the instruction directory has no YAML frontmatter
- **THEN** the file is silently skipped
- **AND** not included in the returned `Instruction[]`

#### Scenario: autoApply includes full content
- **WHEN** a file has `autoApply: true` in frontmatter
- **THEN** the returned `Instruction` includes `content` with the full file body
- **AND** no size limit is applied

### Requirement: PiEngine injects instruction blocks into system prompt
The system SHALL resolve `projectPath` via `lookupProjectPath()` and call `this.dialectResolver.getInstructions(projectPath ?? cwd, cwd)` in `PiEngine.createManagedExecution()` — the first argument (cwd) is ALWAYS the projectPath, the second is the git worktree root. The results SHALL be formatted as markdown blocks and appended to the `enrichedSystem` before passing to the session manager.

#### Scenario: Instructions injected into system prompt
- **WHEN** `getInstructions()` returns non-empty `Instruction[]`
- **THEN** each instruction is formatted as a markdown block (e.g., `### conventions\n\n**Project conventions**\n\ncontent`)
- **AND** blocks are joined with double newlines
- **AND** appended to `enrichedSystem` between taskBlock and systemInstructions
- **AND** the session is created with the enriched system prompt

#### Scenario: Project-root instructions scanned in monorepo setups
- **WHEN** a task's `projectPath` differs from the git worktree root
- **AND** instruction files exist only at `<projectPath>/<convention>/`
- **THEN** the instructions are scanned and injected (the worktree root is NOT passed as `cwd`)
- **AND** projectPath files have higher priority (deduplicated by name)

#### Scenario: No instructions found
- **WHEN** `getInstructions()` returns empty `[]`
- **THEN** no instruction blocks are added to `enrichedSystem`
- **AND** the system prompt is constructed normally

### Requirement: PiEngine logs instruction loading
The system SHALL log a structured JSON line when instruction files are loaded by the Pi engine. The log SHALL include event type, engine name, count of instructions loaded, and file paths.

#### Scenario: Instructions loaded log emitted
- **WHEN** instruction files are found and parsed
- **THEN** a JSON log line is emitted with format: `{"event": "instructions_loaded", "engine": "pi", "count": N, "files": ["path1", "path2"]}`
