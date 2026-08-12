## Purpose
Defines the `CursorDialect` implementation of `SlashCommandDialect` for the Cursor engine, using native Cursor conventions across three lookup scopes — project, worktree, and user home: `.cursor/commands/` for slash-command files (plain `.md`, recursive with colon-namespaced subdirectories) and `.cursor/skills/` for skill paths.

## Requirements

### Requirement: CursorDialect implements SlashCommandDialect for the Cursor engine
The system SHALL provide a `CursorDialect` class that implements `SlashCommandDialect` using native Cursor conventions across three lookup scopes: `.cursor/commands/` for commands (plain `.md`, recursive with colon-namespaced subdirs) and `.cursor/skills/` for skill paths, scanned at `<projectPath>`, then `<worktreePath>`, then user home (`~/.cursor`), mirroring `CopilotDialect` and `ClaudeDialect`.

#### Scenario: Flat command discovery
- **WHEN** `CursorDialect.listCommands(worktreePath, projectPath)` is called
- **THEN** it scans `<projectPath>/.cursor/commands/`, then `<worktreePath>/.cursor/commands/` (when different), then `~/.cursor/commands/`, in that priority order
- **AND** a flat file `commands/create-or-update-pr.md` is returned as name `create-or-update-pr`
- **AND** deduplicates by command name (projectPath wins over worktreePath, worktreePath wins over home)
- **AND** returns a `CommandInfo[]` with `name` and optional `description` from YAML frontmatter

#### Scenario: Home-scope command discovery
- **WHEN** a user-level command file `~/.cursor/commands/home-tool.md` exists and no project/worktree command of the same name exists
- **THEN** `listCommands()` returns it as name `home-tool`
- **AND** `resolvePrompt("/home-tool")` resolves it from `~/.cursor/commands/home-tool.md`

#### Scenario: Project command shadows home command
- **WHEN** both `<projectPath>/.cursor/commands/dup.md` and `~/.cursor/commands/dup.md` exist
- **THEN** `listCommands()` returns a single entry named `dup` sourced from the project path
- **AND** `resolvePrompt("/dup")` resolves the project-path file

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
- **AND** resolves the file from the first candidate directory containing it (project, worktree, then home)
- **AND** returns the XML-wrapped resolved body

#### Scenario: Non-slash value passes through unchanged
- **WHEN** `CursorDialect.resolvePrompt("plain text prompt", worktreePath)` is called
- **THEN** it returns `{ content: "plain text prompt", wasSlash: false }`

#### Scenario: Unresolvable slash reference throws (dialect contract; resolver is fail-soft)
- **WHEN** `CursorDialect.resolvePrompt("/nonexistent-command", worktreePath)` is called and no `.md` file is found in any candidate directory (project, worktree, home)
- **THEN** it throws an error whose message includes the command name and the expected file location
- **AND** the shared `SlashCommandResolver` catches that error and passes the raw prompt through with a warning (see `slash-command-dialect` capability)

#### Scenario: Skill paths returned for existing directories only
- **WHEN** `CursorDialect.getSkillPaths(worktreePath, projectPath)` is called
- **THEN** it returns the subset of `[<projectPath>/.cursor/skills/, <worktreePath>/.cursor/skills/, ~/.cursor/skills/]` that exist on the filesystem
- **AND** omits non-existent directories silently
- **AND** includes home scope (`~/.cursor/skills/`) — Cursor supports user-level skills, matching `CopilotDialect`'s `~/.github/skills/` and `ClaudeDialect`'s `~/.claude/commands`

#### Scenario: CursorDialect registered in the default dialect registry
- **WHEN** `createDefaultDialectRegistry()` is called
- **THEN** `registry.create("cursor")` returns a new `CursorDialect` instance without error

### Requirement: CursorEngine passes DB-resolved paths to getSkillPaths()
The system SHALL resolve projectPath and worktreePath from the database in `CursorEngine._run()` and pass the DB-derived `worktreePath` to `this.dialect.getSkillPaths(worktreePath, projectPath)`, identical to the resolution used by `CursorEngine.listCommands()`.

#### Scenario: DB-derived worktreePath passed to getSkillPaths
- **WHEN** `CursorEngine._run()` is called for a task with `task_git_context.worktree_path` set
- **THEN** the engine passes the DB-derived `worktree_path` (fallback: the `workingDirectory` param) as the dialect's `worktreePath`
- **AND** passes the project path resolved via `getLoadedProjectByKey` (when it differs from the worktree path)
- **AND** skills from `<projectPath>/.cursor/skills/`, `<worktreePath>/.cursor/skills/`, and `~/.cursor/skills/` are loadable

#### Scenario: ProjectPath equals worktreePath
- **WHEN** `projectPath` equals `worktreePath` (same directory)
- **THEN** `getSkillPaths()` returns skills from the single path plus home without duplication
- **AND** no error occurs

#### Scenario: No projectPath available
- **WHEN** the task has no project configured
- **THEN** `getSkillPaths()` is called with the DB worktree path (or `workingDirectory` fallback) and no project path
- **AND** skills are loadable from the worktree root and home
