## MODIFIED Requirements

### Requirement: Slash references resolve to prompt files from the project worktree
The system SHALL resolve a value matching the pattern `/stem` (and optional text argument) — when it appears at the very beginning of the engine-facing value — by reading the corresponding `.prompt.md` file. The resolution SHALL be performed by the engine, not the orchestrator. When a user message is stored with autocomplete chip markup, the system SHALL first derive plain/raw user text from that markup, preserving the leading `/` in slash-command labels before slash resolution is attempted. The system SHALL preserve the original slash invocation as the user-visible chat content and pass the resolved prompt body to the underlying LLM.

For **Copilot engine**, the lookup order SHALL be:
1. `<worktreePath>/.github/prompts/{stem}.prompt.md`
2. `<projectRootPath>/.github/prompts/{stem}.prompt.md` (only when `projectRootPath` differs from `worktreePath`)
3. `~/.github/prompts/{stem}.prompt.md` (personal/user scope)

For **Claude engine**, slash recognition is delegated to the SDK after Railyin derives the plain/raw `/stem` text from stored chip markup; no filesystem lookup is performed by Railyin.

#### Scenario: Valid slash reference resolves to prompt body (Copilot — worktree scope)
- **WHEN** a value starts with `/opsx-propose` and `<worktreePath>/.github/prompts/opsx-propose.prompt.md` exists
- **THEN** the file is read, YAML frontmatter is stripped, and the body is returned as the resolved prompt text

#### Scenario: Autocomplete-selected slash chip preserves leading slash
- **WHEN** the user selected a slash command from autocomplete and the stored message contains slash chip markup
- **THEN** the derived engine-facing text begins with `/command` and remains eligible for slash resolution

#### Scenario: Worktree lookup falls back to project root (Copilot)
- **WHEN** the worktree does not contain the prompt file but `<projectRootPath>/.github/prompts/{stem}.prompt.md` exists and projectRootPath differs from `worktreePath`
- **THEN** the project root file is used and resolution succeeds

#### Scenario: Personal scope used as final fallback (Copilot)
- **WHEN** neither worktree nor project root contain the prompt file but `~/.github/prompts/{stem}.prompt.md` exists
- **THEN** the personal scope file is used and resolution succeeds

#### Scenario: File not found in all Copilot scopes surfaces a hard error
- **WHEN** the referenced file does not exist in worktreePath, projectRootPath, or `~/.github/prompts/`
- **THEN** resolution fails with a descriptive error message; no AI call is made

#### Scenario: Slash reference not at the beginning is not resolved
- **WHEN** a value contains `/opsx-propose` but does not start with it
- **THEN** the value is used as-is with no resolution attempted

#### Scenario: Frontmatter is stripped from resolved file
- **WHEN** the resolved `.prompt.md` begins with a `---`-delimited YAML block
- **THEN** only the content below the closing `---` is returned

#### Scenario: $input is substituted with the argument text
- **WHEN** the slash reference includes trailing argument text (e.g. `/opsx-propose add-dark-mode`)
- **THEN** every occurrence of `$input` in the resolved prompt body is replaced with the argument text

#### Scenario: $input is replaced with empty string when no argument provided
- **WHEN** the slash reference has no trailing argument text
- **THEN** every occurrence of `$input` is replaced with an empty string

#### Scenario: Non-slash values pass through unchanged
- **WHEN** a value does not start with `/stem` pattern
- **THEN** the value is used as-is with no resolution attempted
