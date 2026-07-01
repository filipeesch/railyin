## ADDED Requirements

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

### Test scenarios (unit — `cursor/cursor-dialect.test.ts`)

Mirrors `claude-dialect.test.ts` structurally (same `mkdtempSync` + filesystem approach). Key cases:

#### listCommands
- Returns empty array when `.cursor/commands/` does not exist
- Returns flat `.md` commands by stem name
- Ignores non-`.md` files (`.DS_Store`, `.mdc`, etc.)
- Recurses into subdirectories; names are colon-namespaced
- Extracts `description` from YAML frontmatter when present
- Returns `undefined` description when no frontmatter
- Deduplicates: projectPath wins over worktreePath for same name
- Returns both project-only and worktree-only commands when no overlap
- Skips worktreePath scan when it equals projectPath (no duplication)

#### resolvePrompt
- Non-slash value passes through unchanged (`wasSlash: false`)
- Empty string passes through unchanged
- Resolves flat slash reference → XML-wraps body
- Resolves colon-namespaced reference → maps to subdir file
- Substitutes `$input` with same-line arg
- Replaces ALL occurrences of `$input`
- `$input` → empty string when no arg provided
- Post-newline content appended to resolved body
- Same-line arg + post-newline together
- Throws descriptive error when file not found; includes expected path
- Path priority: projectPath > worktreePath; throws when both miss

#### getSkillPaths
- Returns only existing directories
- Returns projectPath skills before worktreePath skills
- Skips worktreePath when it equals projectPath
- Returns empty list when no `.cursor/skills/` anywhere
- Does NOT include `~/.cursor/skills/`

### Test scenarios (integration — `list-commands.test.ts`)

Mirrors `ClaudeEngine.listCommands — path resolution` section:

- `CursorEngine.listCommands()` delegates to `dialect.listCommands(worktreePath, projectPath)` with DB-resolved paths
- Falls back to `worktree_path` when project not found in config
- Returns empty array when task row does not exist

### Test scenarios (registry — `slash-command-dialect-registry.test.ts`)

- `createDefaultDialectRegistry()` returns a `CursorDialect` for `"cursor"`
