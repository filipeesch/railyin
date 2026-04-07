## ADDED Requirements

### Requirement: Languages are detected when a project is registered
The system SHALL scan the project root directory (depth 1) against all registry detection globs immediately after a project is successfully saved. The result is a list of detected language entries from the registry.

#### Scenario: Project with multiple languages detected
- **WHEN** a project root contains both `tsconfig.json` and `Cargo.toml`
- **THEN** both TypeScript/JS and Rust are included in the detected languages

#### Scenario: Project with no recognized languages
- **WHEN** the project root contains no files matching any registry detection glob
- **THEN** the detected languages list is empty and the LSP setup prompt is not shown

### Requirement: Installed LSP server binaries are probed cross-platform
For each detected language, the system SHALL check whether the corresponding server binary is available on `$PATH` using `which <binary>` on macOS/Linux and `where <binary>` on Windows. The result is a boolean `alreadyInstalled` flag per language.

#### Scenario: Binary found on PATH
- **WHEN** `which typescript-language-server` exits with code 0
- **THEN** `alreadyInstalled` is `true` for the TypeScript/JS entry

#### Scenario: Binary not on PATH
- **WHEN** `which typescript-language-server` exits with non-zero code
- **THEN** `alreadyInstalled` is `false` for the TypeScript/JS entry

#### Scenario: Probe uses correct command on Windows
- **WHEN** the runtime OS is Windows
- **THEN** `where <binary>` is used instead of `which <binary>`

### Requirement: Setup prompt is shown after project registration
The system SHALL display a non-blocking LSP setup prompt in the Add Project UI after the project is saved. The prompt SHALL list each detected language with its install status and platform-appropriate install options.

#### Scenario: Setup prompt lists detected language with install status
- **WHEN** the setup prompt is displayed for a project with TypeScript detected and server not installed
- **THEN** the prompt shows "TypeScript / JavaScript" with `alreadyInstalled: false` and available install options

#### Scenario: Already-installed server shown with installed indicator
- **WHEN** a language is detected and its server binary is already on PATH
- **THEN** the prompt shows the language as already installed, with an option to add to config only

#### Scenario: Setup prompt is skippable
- **WHEN** the user dismisses the setup prompt without selecting any options
- **THEN** no install commands are run and no config changes are made

### Requirement: Selected install commands execute in a login shell
The system SHALL execute the user-selected install command via the OS login shell (`sh -l -c <command>` on macOS/Linux, `cmd /c <command>` on Windows) so that shell profile PATH modifications are available.

#### Scenario: Install runs in login shell on macOS
- **WHEN** the user confirms installation of `rust-analyzer` via `rustup`
- **THEN** the command runs as `sh -l -c "rustup component add rust-analyzer"` so `~/.cargo/env` is sourced

#### Scenario: Install output is streamed to the UI
- **WHEN** an install command is running
- **THEN** stdout and stderr are streamed line-by-line to the UI so the user can observe progress

#### Scenario: Install failure is surfaced without blocking
- **WHEN** an install command exits with non-zero status
- **THEN** the UI shows the error output and the workspace.yaml is NOT modified for that language

### Requirement: Successful setup writes server entry to workspace.yaml
After a successful install (exit code 0) or when the user selects "already installed — add to config", the system SHALL add the server definition to the `lsp.servers` array in `workspace.yaml`, deduplicating by server `name`.

#### Scenario: New server entry written to workspace.yaml
- **WHEN** `typescript-language-server` is successfully installed
- **THEN** workspace.yaml gains an `lsp.servers` entry with `name: typescript`, `command: typescript-language-server`, `args: ["--stdio"]`, and the appropriate `extensions` list

#### Scenario: Duplicate entry not written
- **WHEN** workspace.yaml already contains an `lsp.servers` entry with `name: typescript`
- **THEN** the system does not add a duplicate entry

#### Scenario: Config written for already-installed server
- **WHEN** the user selects "add to config" for an already-installed server
- **THEN** the server entry is written to workspace.yaml without running any install command
