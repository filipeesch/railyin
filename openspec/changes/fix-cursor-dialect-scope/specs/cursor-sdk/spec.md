## MODIFIED Requirements

### Requirement: Slash command resolution via the shared SlashCommandResolver
The system SHALL resolve slash-command references in Cursor engine prompts via `CursorDialect.resolvePrompt()` before dispatching to the SDK, performed upstream by the executor layer's `SlashCommandResolver` (before history/stage-instruction blocks are joined into the prompt). Unresolvable slash references SHALL pass through unchanged with a warning instead of failing the send.

#### Scenario: on_enter_prompt with slash reference is expanded
- **WHEN** a task transitions to a column whose `on_enter_prompt` is `/gsd-execute-phase`
- **THEN** the executor-layer `SlashCommandResolver` resolves it via `CursorDialect.resolvePrompt()` to the XML-wrapped file body
- **AND** the resolved content is sent to the Cursor SDK as the agent prompt, not the raw `/gsd-execute-phase` string

#### Scenario: Plain prompt is passed through unchanged
- **WHEN** the prompt does not start with a slash reference
- **THEN** the engine sends it to the SDK unchanged

#### Scenario: Unresolvable slash reference passes through with a warning
- **WHEN** the prompt starts with a slash reference that matches no command file in any `CursorDialect` candidate directory (project, worktree, home)
- **THEN** the shared `SlashCommandResolver` catches the dialect's resolution error, logs a warning identifying the engine/dialect and the unresolved reference
- **AND** returns the raw prompt unchanged so the send proceeds (the agent sees the literal `/command` text)

### Requirement: Skills exposed via lazy skill tool and available_skills listing
The system SHALL NOT inline every `SKILL.md` into the prompt prefix. Instead, the Cursor engine SHALL expose skills through a compact `<available_skills>` index (name + one-line description) injected into the system-instructions prefix, plus a lazy `skill` `SDKCustomTool` that loads a `SKILL.md` on demand, so home-scoped skill libraries (e.g. `~/.cursor/skills/` with 100+ entries) are usable without unbounded token growth.

#### Scenario: Available skills listing injected into prefix
- **WHEN** `CursorEngine._run()` starts and `dialect.getSkillPaths(worktreePath, projectPath)` returns one or more existing skill directories
- **THEN** the engine builds a bounded `## Available Skills` block listing each skill's `name` and a one-line `description` parsed from its `SKILL.md` frontmatter
- **AND** the block is prepended to the prompt prefix alongside the system block
- **AND** no `SKILL.md` body content is inlined into the prefix

#### Scenario: Skill tool registered as an SDKCustomTool
- **WHEN** `buildCursorTools()` is invoked with a skill resolver
- **THEN** a `skill` `SDKCustomTool` is registered whose schema is `{ name: string }`
- **AND** executing it resolves and returns the named skill's `SKILL.md` content from the first path that contains it
- **AND** when the name is unknown, it returns the list of available skill names (with a fuzzy suggestion when a close match exists)

#### Scenario: No skill directories — no listing, no skill tool change
- **WHEN** no skill directories exist for the task's paths (project, worktree, or home)
- **THEN** the `<available_skills>` block is omitted from the prefix
- **AND** the engine still registers the `skill` tool (which reports "no skills available" when invoked)

### Requirement: Cursor native project rules loaded automatically
The system SHALL pass `settingSources: ["project"]` to the Cursor SDK's local agent options so `.cursorrules` and `.cursor/rules/*.mdc` files are loaded automatically on every run. (Unchanged — restated for completeness with this change.)

#### Scenario: settingSources included in agent options
- **WHEN** the adapter calls `Agent.create` or `Agent.resume`
- **THEN** it includes `settingSources: ["project"]` in the `local` options
- **AND** the SDK loads `.cursorrules` and `.cursor/rules/*.mdc` from the agent working directory

### Requirement: listCommands resolves paths from DB like other engines
The system SHALL resolve the task's worktree path and project path from the database in `CursorEngine.listCommands()`, identical to the pattern used by `CopilotEngine` and `ClaudeEngine`, and SHALL share that resolution with `_run()` so the two call sites cannot drift.

#### Scenario: listCommands returns commands from worktree, project, and home paths
- **WHEN** `CursorEngine.listCommands(taskId)` is called for a task with a known worktree and project
- **THEN** it queries `task_git_context.worktree_path` for the worktree
- **AND** resolves the project path via `getLoadedProjectByKey`
- **AND** delegates to `CursorDialect.listCommands(worktreePath, projectPath)`, which additionally scans `~/.cursor/commands/`
