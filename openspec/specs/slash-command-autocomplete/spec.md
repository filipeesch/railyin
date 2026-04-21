## Purpose
Provides `/`-triggered autocomplete in the chat editor for discovering and selecting slash commands, with engine-specific command discovery strategies.

## Requirements

### Requirement: Typing `/` in the chat editor triggers a slash command picker
The system SHALL open an autocomplete dropdown when the user types `/` at any position in the chat editor. The dropdown SHALL list all slash commands discoverable from the active engine for the current task. The list SHALL update as the user continues typing (fuzzy/substring match on command name).

#### Scenario: Dropdown opens on `/`
- **WHEN** the user types `/` in the chat editor
- **THEN** an autocomplete dropdown appears showing all available commands with their names and descriptions

#### Scenario: List filters as user types
- **WHEN** the user types `/pro` after opening the picker
- **THEN** the dropdown narrows to commands whose names contain or fuzzy-match `pro`

#### Scenario: Selecting a command inserts a chip
- **WHEN** the user clicks or keyboard-selects a command from the dropdown
- **THEN** the `/query` text is replaced by an atomic chip token for that command, and the dropdown closes

#### Scenario: Empty list shown gracefully when no commands exist
- **WHEN** the engine has no discoverable commands
- **THEN** the dropdown shows an empty state message (e.g. "No commands found") rather than staying open with nothing

#### Scenario: Escape dismisses the dropdown
- **WHEN** the dropdown is open and the user presses Escape
- **THEN** the dropdown closes and the typed text is preserved as-is

### Requirement: Claude engine lists commands via `session.supportedCommands()`
The system SHALL retrieve slash commands for Claude engine tasks by calling the SDK's `session.supportedCommands()` method. No filesystem fallback is performed. If the session is not yet active, an empty list is returned.

#### Scenario: Commands returned from active Claude session
- **WHEN** a Claude session is active and `session.supportedCommands()` returns results
- **THEN** the picker shows those commands with name, description, and argument hint

#### Scenario: No session returns empty list
- **WHEN** no Claude session is active at the moment the picker opens
- **THEN** an empty list is returned and the picker shows the empty state

### Requirement: Copilot engine lists commands by globbing three path scopes
The system SHALL retrieve slash commands for Copilot engine tasks by globbing `*.prompt.md` files across three ordered scopes: (1) worktreePath, (2) projectRootPath when it differs from worktreePath, (3) the user's personal `~/.github/prompts/` directory. Commands are deduplicated by name; earlier scopes take precedence. The glob is performed fresh on every picker open — no caching.

#### Scenario: Commands from worktree scope
- **WHEN** `<worktreePath>/.github/prompts/` contains `opsx-propose.prompt.md`
- **THEN** `opsx-propose` appears in the command list

#### Scenario: Commands from project root scope (when differs)
- **WHEN** `projectRootPath` differs from `worktreePath` and `<projectRootPath>/.github/prompts/` contains `deploy.prompt.md`
- **THEN** `deploy` appears in the command list

#### Scenario: Commands from personal scope
- **WHEN** `~/.github/prompts/` contains `my-snippet.prompt.md`
- **THEN** `my-snippet` appears in the command list

#### Scenario: Deduplication by name (worktree wins)
- **WHEN** the same command name appears in both `worktreePath` and `~/.github/prompts/`
- **THEN** only the worktree version is shown; the personal version is ignored

#### Scenario: Newly created command appears immediately
- **WHEN** a new `.prompt.md` file is added to the worktree between two picker opens
- **THEN** the new command appears the next time the user types `/` (no stale cache)
