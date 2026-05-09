## MODIFIED Requirements

### Requirement: Slash references resolve to prompt files from the project worktree
The system SHALL resolve a value matching the pattern `/stem` (and optional text argument) — when it appears at the very beginning of the engine-facing value — by reading the corresponding prompt file. The resolution SHALL be performed by the engine, not the orchestrator, using the engine's injected `SlashCommandDialect`. When a user message is stored with autocomplete chip markup, the system SHALL first derive plain/raw user text from that markup, preserving the leading `/` in slash-command labels before slash resolution is attempted. The system SHALL preserve the original slash invocation as the user-visible chat content and pass the resolved prompt body to the underlying LLM.

For **CopilotDialect** (used by Copilot engine and optionally by Pi), the lookup order SHALL be:
1. `<projectRootPath>/.github/prompts/{stem}.prompt.md` (project root — always first)
2. `<worktreePath>/.github/prompts/{stem}.prompt.md` (only when `worktreePath` differs from `projectRootPath`)
3. `~/.github/prompts/{stem}.prompt.md` (personal/user scope)

For **ClaudeDialect** (optionally used by Pi engine), the lookup order SHALL be:
1. `<projectRootPath>/.claude/commands/{stem}.md` (project root — always first)
2. `<worktreePath>/.claude/commands/{stem}.md` (only when `worktreePath` differs from `projectRootPath`)
3. `~/.claude/commands/{stem}.md` (personal/user scope)

For **Claude engine**, slash recognition is delegated to the SDK after Railyin derives the plain/raw `/stem` text from stored chip markup; no filesystem lookup is performed by Railyin.

For **Pi engine with NullDialect** (default), slash references are passed through unchanged to the underlying LLM.

#### Scenario: Valid slash reference resolves to prompt body (CopilotDialect — project root scope)
- **WHEN** a value starts with `/opsx-propose` and `<projectRootPath>/.github/prompts/opsx-propose.prompt.md` exists
- **THEN** the file is read, YAML frontmatter is stripped, the body is XML-wrapped as `<command name="opsx-propose" args="">…</command>`, and returned as the resolved prompt

#### Scenario: Pi engine with dialect copilot resolves from .github/prompts
- **WHEN** a Pi engine task has `dialect: copilot` and the message is `/opsx-propose foo`
- **THEN** the file is looked up in `.github/prompts/`, body is XML-wrapped, and sent to the Pi LLM

#### Scenario: Pi engine with dialect claude resolves from .claude/commands
- **WHEN** a Pi engine task has `dialect: claude` and the message is `/my-command foo`
- **THEN** the file is looked up in `.claude/commands/`, body is XML-wrapped, and sent to the Pi LLM

#### Scenario: Pi engine with no dialect passes slash reference through unchanged
- **WHEN** a Pi engine task has no `dialect` configured and the message is `/opsx-propose foo`
- **THEN** the literal string `/opsx-propose foo` is sent to the LLM without resolution

#### Scenario: Autocomplete-selected slash chip preserves leading slash
- **WHEN** the user selected a slash command from autocomplete and the stored message contains slash chip markup
- **THEN** the derived engine-facing text begins with `/command` and remains eligible for slash resolution

#### Scenario: Project root lookup falls back to worktree (CopilotDialect)
- **WHEN** the project root does not contain the prompt file but `<worktreePath>/.github/prompts/{stem}.prompt.md` exists and worktreePath differs from projectRootPath
- **THEN** the worktree file is used and resolution succeeds

#### Scenario: Personal scope used as final fallback (CopilotDialect)
- **WHEN** neither worktree nor project root contain the prompt file but `~/.github/prompts/{stem}.prompt.md` exists
- **THEN** the personal scope file is used and resolution succeeds

#### Scenario: File not found in all CopilotDialect scopes surfaces a hard error
- **WHEN** the referenced file does not exist in worktreePath, projectRootPath, or `~/.github/prompts/`
- **THEN** resolution fails with a descriptive error message; no AI call is made

#### Scenario: Slash reference not at the beginning is not resolved
- **WHEN** a value contains `/opsx-propose` but does not start with it
- **THEN** the value is used as-is with no resolution attempted

#### Scenario: Frontmatter is stripped from resolved CopilotDialect file
- **WHEN** the resolved `.prompt.md` begins with a `---`-delimited YAML block
- **THEN** only the content below the closing `---` is returned (inside the XML wrapper)

#### Scenario: $input is substituted with the argument text
- **WHEN** the slash reference includes trailing argument text (e.g. `/opsx-propose add-dark-mode`)
- **THEN** every occurrence of `$input` in the resolved prompt body is replaced with the argument text

#### Scenario: $input is replaced with empty string when no argument provided
- **WHEN** the slash reference has no trailing argument text
- **THEN** every occurrence of `$input` is replaced with an empty string

#### Scenario: Non-slash values pass through unchanged
- **WHEN** a value does not start with `/stem` pattern
- **THEN** the value is used as-is with no resolution attempted

### Requirement: Slash command chips with colon-separated names pass cleanly to the Claude SDK
For **Claude engine**, when a user message contains a slash chip using colon-separated subdirectory notation, the system SHALL derive a plain `/namespace:command` string and pass it as the engine-facing prompt, so the Claude SDK can resolve it natively.

#### Scenario: Colon-separated chip text is eligible for Claude SDK slash resolution
- **WHEN** the stored message contains `[/opsx:propose|/opsx:propose]` chip markup
- **THEN** the derived engine-facing text begins with `/opsx:propose` and retains the colon separator unchanged

## REMOVED Requirements

### Requirement: Copilot dialect resolver is a shared engine-layer library
**Reason**: `copilot-prompt-resolver.ts` is superseded by the `SlashCommandDialect` abstraction. The `CopilotDialect` class at `src/bun/engine/dialects/copilot-dialect.ts` replaces it as the canonical implementation. Resolution is now dialect-driven via `SlashCommandDialectRegistry`; there is no longer a shared free function.
**Migration**: Import from `src/bun/engine/dialects/copilot-dialect.ts` (class method) or obtain a dialect via `SlashCommandDialectRegistry.create("copilot")`. The `resolvePrompt()` free-function signature is removed; callers use `dialect.resolvePrompt()` instead.
