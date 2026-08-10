## MODIFIED Requirements

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
