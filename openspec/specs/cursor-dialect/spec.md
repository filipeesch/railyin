## Purpose
Defines the `CursorDialect` implementation of `SlashCommandDialect` for the Cursor engine, using native Cursor project conventions: `.cursor/commands/` for slash-command files (plain `.md`, recursive with colon-namespaced subdirectories) and `.cursor/skills/` for skill injection paths.

## Requirements

### Requirement: CursorDialect implements SlashCommandDialect for the Cursor engine
The system SHALL provide a `CursorDialect` class that implements `SlashCommandDialect` using native Cursor project conventions: `.cursor/commands/` for commands (plain `.md`, recursive with colon-namespaced subdirs) and `.cursor/skills/` for skill paths.

#### Scenario: Flat command discovery
- **WHEN** `CursorDialect.listCommands(worktreePath, projectPath)` is called
- **THEN** it scans `<projectPath>/.cursor/commands/` and `<worktreePath>/.cursor/commands/` in that priority order (projectPath highest)
- **AND** a flat file `commands/create-or-update-pr.md` is returned as name `create-or-update-pr`
- **AND** deduplicates by command name (projectPath wins over worktreePath)
- **AND** returns a `CommandInfo[]` with `name` and optional `description` from YAML frontmatter

#### Scenario: Subdirectory commands are colon-namespaced
- **WHEN** `.cursor/commands/shared/api-design-auditor.md` exists
- **THEN** `listCommands()` returns it as name `shared:api-design-auditor`
- **AND** deeper nesting `shared/selfservice/migrate_java25.md` is returned as `shared:selfservice:migrate_java25`

#### Scenario: Slash command resolution with input substitution
- **WHEN** `CursorDialect.resolvePrompt("/create-or-update-pr my-branch", worktreePath)` is called
- **THEN** it locates `commands/create-or-update-pr.md` in the first candidate directory that contains it
- **AND** substitutes `$input` with `my-branch`
- **AND** returns `{ content: '<command name="create-or-update-pr" args="my-branch">\n…body…\n</command>', wasSlash: true, sourceCommand: "create-or-update-pr", sourceArgs: "my-branch" }`

#### Scenario: Colon-namespaced slash reference resolves to subdir file
- **WHEN** `CursorDialect.resolvePrompt("/shared:api-design-auditor", worktreePath)` is called
- **THEN** it maps `shared:api-design-auditor` → `shared/api-design-auditor.md`
- **AND** resolves the file from `<projectPath>/.cursor/commands/shared/api-design-auditor.md` or `<worktreePath>/.cursor/commands/shared/api-design-auditor.md`
- **AND** returns the XML-wrapped resolved body

#### Scenario: Non-slash value passes through unchanged
- **WHEN** `CursorDialect.resolvePrompt("plain text prompt", worktreePath)` is called
- **THEN** it returns `{ content: "plain text prompt", wasSlash: false }`

#### Scenario: Unresolvable slash reference throws
- **WHEN** `CursorDialect.resolvePrompt("/nonexistent-command", worktreePath)` is called and no `.md` file is found in any candidate directory
- **THEN** it throws an error whose message includes the command name and the expected file location

#### Scenario: Skill paths returned for existing directories only
- **WHEN** `CursorDialect.getSkillPaths(worktreePath, projectPath)` is called
- **THEN** it returns the subset of `[<projectPath>/.cursor/skills/, <worktreePath>/.cursor/skills/]` that exist on the filesystem
- **AND** omits non-existent directories silently
- **AND** does NOT include home-scope (`~/.cursor/`) — Cursor skills are project-scoped by convention

#### Scenario: CursorDialect registered in the default dialect registry
- **WHEN** `createDefaultDialectRegistry()` is called
- **THEN** `registry.create("cursor")` returns a new `CursorDialect` instance without error

### Requirement: CursorEngine passes projectPath to getSkillPaths()
The system SHALL resolve projectPath from the database in `CursorEngine._run()` and pass it to `this.dialect.getSkillPaths(workingDirectory, projectPath)`. This enables loading skills from the monorepo project root in addition to the worktree root.

#### Scenario: ProjectPath resolved and passed to getSkillPaths
- **WHEN** `CursorEngine._run()` is called for a task with a project that has `projectPath` different from `worktree_path`
- **THEN** the engine resolves `projectPath` from the database (same pattern as `listCommands()`)
- **AND** calls `this.dialect.getSkillPaths(workingDirectory, projectPath)`
- **AND** skills from both `<projectPath>/.cursor/skills/` and `<worktreePath>/.cursor/skills/` are loaded

#### Scenario: ProjectPath equals worktreePath
- **WHEN** `projectPath` equals `worktreePath` (same directory)
- **THEN** `getSkillPaths()` returns skills from the single path without duplication
- **AND** no error occurs

#### Scenario: No projectPath available
- **WHEN** the task has no project configured or `projectPath` equals `worktreePath`
- **THEN** `getSkillPaths()` is called with only `workingDirectory`
- **AND** skills are loaded from the worktree root only
