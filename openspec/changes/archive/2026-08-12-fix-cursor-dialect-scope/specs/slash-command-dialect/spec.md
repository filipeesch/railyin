## ADDED Requirements

### Requirement: Fail-soft slash resolution policy at the shared resolver
The system SHALL apply a fail-soft policy in `SlashCommandResolver.resolve()`: when the target engine's dialect throws while resolving a slash reference (e.g. command file not found), the resolver SHALL log a warning and return the raw prompt unchanged instead of propagating the error. This policy SHALL apply uniformly to every dialect-driven engine (Copilot, Cursor, Pi) since they all resolve through this single choke point.

#### Scenario: Unresolvable slash reference passes through for Cursor
- **WHEN** `SlashCommandResolver.resolve(config, "cursor", "/missing-cmd", worktreePath, projectPath)` is called and `CursorDialect.resolvePrompt()` throws "could not be resolved"
- **THEN** the resolver logs a warning that includes the engine id and the unresolved reference
- **AND** returns the original `/missing-cmd` string unchanged

#### Scenario: Unresolvable slash reference passes through for Copilot and Pi
- **WHEN** any dialect-driven engine's resolution throws (CopilotDialect, ClaudeDialect used by Pi, CursorDialect)
- **THEN** the same pass-through-with-warning behavior applies

#### Scenario: Successful resolution is unchanged
- **WHEN** `dialect.resolvePrompt()` returns a resolved prompt (or a non-slash pass-through)
- **THEN** the resolver returns `resolved.content` exactly as before; no warning is logged

#### Scenario: Genuine non-resolution errors are still surfaced
- **WHEN** `dialect.resolvePrompt()` throws for a reason other than an unresolvable slash reference (e.g. filesystem I/O failure)
- **THEN** the resolver still catches and logs, returning the raw prompt — the engine never hard-fails a user send on slash resolution
