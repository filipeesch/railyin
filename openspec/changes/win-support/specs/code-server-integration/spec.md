## MODIFIED Requirements

### Requirement: code-server binary is fetched and cached automatically
The system SHALL discover the `code-server` binary using a cross-platform strategy: prefer the locally-installed `node_modules/.bin/code-server`, then `Bun.which("code-server")`, then fall back to `npx --yes code-server`. The previous `which code-server` shell-out is removed so binary discovery works on Windows even though the runtime feature is gated.

#### Scenario: Binary discovered via local node_modules on every platform
- **WHEN** `code-server` is installed under `node_modules/.bin/`
- **THEN** that path is used regardless of host platform

#### Scenario: Binary discovered via Bun.which on Unix
- **WHEN** `code-server` is on `$PATH` (e.g. via Homebrew)
- **THEN** `Bun.which` returns the absolute path and it is used

#### Scenario: npx fallback used when no local install
- **WHEN** `code-server` is not in `node_modules` and not on PATH
- **THEN** the system invokes `npx --yes code-server ...` and code-server is downloaded on first use

## ADDED Requirements

### Requirement: code-server is unavailable on Windows
The system SHALL detect the Windows platform at the start of `startCodeServer` and SHALL throw a descriptive error rather than spawning the binary. The error message SHALL guide the user to use an external editor instead. The frontend SHALL surface this error as a user-facing notice (e.g. toast) without leaving the UI in a broken state.

#### Scenario: Starting code-server on Windows throws a friendly error
- **WHEN** the user clicks the code-server launch button on Windows
- **THEN** `startCodeServer` throws an error containing the text "not supported on Windows" and suggesting an external editor

#### Scenario: Other code-server entry points are no-ops on Windows
- **WHEN** `stopCodeServer`, `getCodeServerEntry`, or `stopAllCodeServers` are called on Windows
- **THEN** they return safely without error (no entry exists in the registry, so the existing implementation is already correct)

#### Scenario: External editor launch still works on Windows
- **WHEN** the user invokes "Open in external editor" with VS Code on PATH
- **THEN** `launchApp("code .", cwd)` runs successfully via the platform-aware shell, independently of code-server availability
