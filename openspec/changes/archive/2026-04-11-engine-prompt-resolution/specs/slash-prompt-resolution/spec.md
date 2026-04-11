## MODIFIED Requirements

### Requirement: Slash references resolve to prompt files from the project worktree
The system SHALL resolve a value matching the pattern `/stem` (and optional text argument) — when it appears at the very beginning of the value — by reading `.github/prompts/{stem}.prompt.md`. The resolution SHALL be performed by the engine, not the orchestrator. The lookup SHALL first check the project worktree, then fall back to `process.cwd()/.github/prompts/` (the railyin app repo). The system SHALL preserve the original slash invocation as the user-visible chat content and pass the resolved prompt body to the underlying LLM.

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

#### Scenario: Worktree lookup falls back to app repo
- **WHEN** the worktree does not contain `.github/prompts/opsx-propose.prompt.md` but `process.cwd()/.github/prompts/opsx-propose.prompt.md` exists
- **THEN** the app repo file is used and resolution succeeds

#### Scenario: File not found in both worktree and app repo surfaces a hard error
- **WHEN** the referenced file does not exist in either the worktree or `process.cwd()/.github/prompts/`
- **THEN** resolution fails with a descriptive error message identifying the missing path; no AI call is made

#### Scenario: Non-slash values pass through unchanged
- **WHEN** a value does not start with `/stem` pattern
- **THEN** the value is used as-is with no resolution attempted

## REMOVED Requirements

### Requirement: Visible chat shows slash invocation, engine receives resolved body via resolved_content metadata
**Reason**: `resolved_content` metadata is no longer written to `conversation_messages`. The raw slash reference stored as message content IS the correct display value. Engine resolution happens internally and is not persisted.
**Migration**: Remove reads of `metadata.resolved_content` from any display logic. The `content` field of prompt messages already contains the user-visible value.

### Requirement: Resolved prompt body is not rendered as a normal user bubble
**Reason**: No longer applicable — the raw slash reference is the message content; there is no separate resolved body stored.
**Migration**: None required.

### Requirement: Workflow/internal prompt entries may show compact display text
**Reason**: The `display_content` metadata field is removed along with `resolved_content`. The message `content` field holds the display value directly.
**Migration**: Remove reads of `metadata.display_content` from display logic.
