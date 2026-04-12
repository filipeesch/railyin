## ADDED Requirements

### Requirement: Shell environment resolution at startup

The system SHALL resolve the full user shell environment by spawning a login shell at app startup and capturing its environment, then merge the resolved environment into `process.env` so that all subsequent process spawns inherit the user's full PATH and environment variables.

#### Scenario: .app bundle launched from Dock
- **WHEN** user launches Railyn as a `.app` bundle from macOS Dock (or Finder)
- **THEN** the system spawns the user's configured shell with login+interactive flags, captures its environment, and merges it into `process.env` before any tool execution
- **AND** downstream tools like `run_command`, LSP servers, and external app launches automatically inherit the full environment

#### Scenario: Development build launched from terminal
- **WHEN** user runs `bun run dev` from a terminal
- **THEN** the system detects `RAILYN_CLI=1` environment variable and skips shell resolution (app already has full env)
- **AND** startup does not incur shell spawn overhead

#### Scenario: Linux `.app`-like launch
- **WHEN** Railyn is launched as a non-interactive daemon/systemd service on Linux (e.g., via electrobun packaging)
- **THEN** the system still resolves the shell environment to ensure user-configured tools (nvm, cargo, pyenv) are accessible

### Requirement: Shell detection strategy

The system SHALL detect the user's configured shell using this priority order: `$SHELL` environment variable → `os.userInfo().shell` (reads /etc/passwd) → `/bin/sh` fallback.

#### Scenario: Typical user with configured shell
- **WHEN** app starts on a macOS or Linux system where `$SHELL` is set (e.g., `/bin/zsh`)
- **THEN** the system uses that shell for environment capture

#### Scenario: Edge case where $SHELL is unset
- **WHEN** app starts in a container or unusual environment where `$SHELL` is not set
- **THEN** the system falls back to reading the user's shell entry from `/etc/passwd` via `os.userInfo().shell()`

#### Scenario: Fallback when shell detection fails
- **WHEN** both `$SHELL` and `userInfo().shell` are unavailable (very rare)
- **THEN** the system falls back to `/bin/sh` and proceeds with resolution

### Requirement: Shell argument strategy by shell type

The system SHALL use appropriate shell arguments based on the detected shell name to ensure both login profiles and interactive customizations are sourced:
- For bash, zsh, fish, and other POSIX shells: use `['-i', '-l', '-c']`
- For csh and tcsh: use `['-ic']` (they don't support `-l` in the same way)
- For PowerShell and Windows shells: skip shell resolution entirely (Windows manages env differently)

#### Scenario: macOS with zsh (default)
- **WHEN** app starts on macOS with `$SHELL=/bin/zsh`
- **THEN** the system spawns `zsh -i -l -c <command>` so both `~/.zprofile` and `~/.zshrc` are sourced
- **AND** nvm, cargo, pyenv, and other tools added via `.zshrc` become visible

#### Scenario: Bash user
- **WHEN** app starts with `$SHELL=/bin/bash`
- **THEN** the system spawns `bash -i -l -c <command>` so both `/etc/profile` and `~/.bashrc` are sourced

#### Scenario: fish shell user
- **WHEN** user has `$SHELL=/usr/bin/fish`
- **THEN** the system spawns `fish -i -l -c <command>` using fish-compatible flags

### Requirement: Environment capture and JSON serialization

The system SHALL capture the environment by spawning the detected shell with the command: `process.execPath -e "console.log(UUID_MARKER + JSON.stringify(process.env) + UUID_MARKER)"`. This avoids fragile string parsing and guarantees clean JSON output.

#### Scenario: Successful environment capture
- **WHEN** the spawned shell executes and sources its profiles (`.zprofile`, `.bashrc`, etc.)
- **THEN** Bun (the `process.execPath` executable) inherits the full environment and serializes it as JSON
- **AND** the JSON output is extracted from the shell's stdout using the UUID markers

#### Scenario: Shell produces diagnostic output
- **WHEN** the user's shell profile contains `echo` statements or other diagnostic output (e.g., motd, nvm banner)
- **THEN** the system strips this noise using UUID markers and correctly extracts only the JSON env block

#### Scenario: Environment contains special characters
- **WHEN** environment variables contain newlines, quotes, or other special characters (e.g., `VERSION="1.0\n2.0"`)
- **THEN** JSON.stringify correctly handles escaping and the parsed result is accurate

### Requirement: Merge into process.env

The system SHALL merge the captured environment into `process.env` with the following logic:
- Shell environment values take precedence (overwrite existing `process.env` values)
- App-set variables (e.g., `RAILYN_DATA_DIR`, `RAILYN_DEBUG`) set *before* the resolution call are preserved
- New variables from the shell are added

#### Scenario: PATH overwrite
- **WHEN** shell env resolution completes with `PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin`
- **THEN** `process.env.PATH` is updated to include Homebrew, user paths, and other shell customizations
- **AND** subsequent `spawn`/`spawnSync` calls inherit this full PATH

#### Scenario: App-specific variables preserved
- **WHEN** app startup code sets `process.env.RAILYN_DATA_DIR` before calling resolver
- **THEN** the resolver does not overwrite `RAILYN_DATA_DIR`; it remains unchanged

#### Scenario: New shell variables added
- **WHEN** shell env contains `NODE_VERSION=18` or other variables not in the initial `process.env`
- **THEN** these variables are added to `process.env` after resolution

### Requirement: Timeout and graceful fallback

The system SHALL enforce a 10-second timeout on shell environment resolution. If resolution exceeds this timeout, the system SHALL log a warning and continue with the existing (unresolved) `process.env`.

#### Scenario: Fast shell resolution
- **WHEN** user's shell profiles are optimized and resolve within 5 seconds
- **THEN** the app continues startup normally with the full resolved environment

#### Scenario: Slow shell profile
- **WHEN** user's `.zshrc` or `.bashrc` takes 12+ seconds to execute (e.g., slow nvm initialization)
- **THEN** the system waits 10 seconds, times out, logs a warning to `~/.railyn/logs/bun.log`, and continues with the unresolved (stripped) env
- **AND** the app remains functional (works with degraded tool visibility)

#### Scenario: Hung shell
- **WHEN** shell process hangs or becomes unresponsive
- **THEN** the 10-second timeout kills the process and logs the error
- **AND** the app continues with existing env

### Requirement: Startup logging

The system SHALL log shell environment resolution status to the app's startup log at `~/.railyn/logs/bun.log` for diagnosability:
- Log the detected shell name
- Log the final resolved `PATH` (sanitized; no sensitive variables)
- Log any errors or timeouts with clear messaging

#### Scenario: Successful resolution logged
- **WHEN** app starts and shell resolution succeeds
- **THEN** log message includes: `[shell-env] Resolved shell: /bin/zsh | PATH contains homebrew, nvm, cargo dirs`

#### Scenario: Resolution timeout logged
- **WHEN** shell resolution times out after 10 seconds
- **THEN** log message includes: `[shell-env] WARNING: Shell resolution timed out after 10s. Using existing PATH.`

#### Scenario: Shell detection failure logged
- **WHEN** shell detection or spawn fails (e.g., `$SHELL` points to deleted binary)
- **THEN** log message includes error details: `[shell-env] ERROR: Failed to spawn shell /bin/zsh: No such file or directory`

### Requirement: Skip resolution when launched from CLI

The system SHALL skip shell environment resolution when the `RAILYN_CLI` environment variable is set to `'1'`. This prevents redundant resolution and startup latency when the app is already launched from a terminal with a full environment.

#### Scenario: Development build with RAILYN_CLI
- **WHEN** `bun run dev` sets `RAILYN_CLI=1` and launches the dev app
- **THEN** the system detects this environment variable and skips shell resolution
- **AND** startup is faster (no shell spawn overhead)

#### Scenario: Production .app without RAILYN_CLI
- **WHEN** user launches the canary/stable `.app` bundle (which does not set `RAILYN_CLI`)
- **THEN** the system runs shell resolution normally

### Requirement: Cross-platform behavior

The system SHALL resolve shell environment on macOS and Linux but skip on Windows (Windows OS inherits environment variables correctly from the OS).

#### Scenario: macOS app launch
- **WHEN** Railyn app runs on macOS
- **THEN** shell environment resolution is performed

#### Scenario: Linux daemon/systemd launch
- **WHEN** Railyn daemon starts on Linux
- **THEN** shell environment resolution is performed

#### Scenario: Windows app launch
- **WHEN** Railyn app runs on Windows
- **THEN** shell resolution is skipped; app uses the environment inherited from Windows (which is complete)

### Requirement: Automatic inheritance by all process spawns

The system SHALL ensure that all downstream process spawns (`spawn`, `spawnSync`, `Bun.spawn`) automatically inherit the resolved environment without per-callsite code changes.

#### Scenario: run_command tool uses resolved env
- **WHEN** AI agent executes `run_command("npm install")`
- **THEN** the spawn call in `workflow/tools.ts` inherits `process.env` (which now contains the full PATH)
- **AND** `npm install` succeeds because `npm` binary is visible

#### Scenario: LSP server launch uses resolved env
- **WHEN** app launches a language server (e.g., `typescript-language-server`) via `lsp/client.ts`
- **THEN** the spawn call inherits the full environment
- **AND** the server can be found even if installed in `~/.nvm` or similar

#### Scenario: External tool launcher uses resolved env
- **WHEN** user clicks a launch profile button (e.g., `code .`) via `launch/launcher.ts`
- **THEN** the spawned shell command inherits environment with full PATH
- **AND** `code` is found via Homebrew or user's PATH

#### Scenario: rg text search uses resolved env
- **WHEN** `workflow/tools.ts` searches for `which rg`
- **THEN** ripgrep is found if installed via Homebrew, nvm, or user's expanded PATH
