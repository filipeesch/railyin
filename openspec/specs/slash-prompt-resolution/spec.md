## Purpose
Provides a reference syntax (`/stem`) that Railyin resolves at execution time by reading a prompt file from the project's worktree. Applies to workflow column fields (`on_enter_prompt`, `stage_instructions`) and task chat input.

## Requirements

### Requirement: Slash references resolve to prompt files from the project worktree
The system SHALL resolve a value matching the pattern `/stem` (and optional text argument) — when it appears at the very beginning of the value — by reading `.github/prompts/{stem}.prompt.md` from the project's worktree. The resolved body (YAML frontmatter stripped) SHALL be used in place of the original reference string.

#### Scenario: Valid slash reference resolves to prompt body
- **WHEN** a value starts with `/opsx-propose` and `.github/prompts/opsx-propose.prompt.md` exists in the worktree
- **THEN** the file is read, YAML frontmatter is stripped, and the body is returned as the resolved prompt text

#### Scenario: Slash reference not at the beginning is not resolved
- **WHEN** a value contains `/opsx-propose` but does not start with it (e.g., `"see /opsx-propose for details"`)
- **THEN** the value is used as-is with no resolution attempted

#### Scenario: Frontmatter is stripped from resolved file
- **WHEN** `.github/prompts/opsx-propose.prompt.md` begins with a `---`-delimited YAML block
- **THEN** only the content below the closing `---` is returned; the frontmatter block is discarded

#### Scenario: $input is substituted with the argument text
- **WHEN** the slash reference includes trailing argument text (e.g., `/opsx-propose add-dark-mode`)
- **THEN** every occurrence of `$input` in the resolved prompt body is replaced with the argument text (`add-dark-mode`)

#### Scenario: $input is replaced with empty string when no argument provided
- **WHEN** the slash reference has no trailing argument text (e.g., `/opsx-sync`)
- **THEN** every occurrence of `$input` in the resolved prompt body is replaced with an empty string

#### Scenario: File not found surfaces a hard error
- **WHEN** the referenced file does not exist in the worktree
- **THEN** resolution fails with a descriptive error message identifying the missing path; no AI call is made

#### Scenario: Non-slash values pass through unchanged
- **WHEN** a value does not start with `/stem` pattern
- **THEN** the value is used as-is with no resolution attempted
