## MODIFIED Requirements

### Requirement: Git binary is resolved cross-platform
The system SHALL resolve the `git` binary using a strategy that works on macOS, Linux, and Windows. Resolution order: (1) `workspace.git_path` from config when set; (2) `Bun.which("git", { PATH })` where `PATH` is joined using `path.delimiter` (`:` on Unix, `;` on Windows); (3) a platform-specific fallback list (`/usr/bin/git`, `/usr/local/bin/git`, `/opt/homebrew/bin/git` on Unix; `C:\Program Files\Git\bin\git.exe`, `C:\Program Files (x86)\Git\bin\git.exe`, `C:\Program Files\Git\cmd\git.exe` on Windows). If none of these resolve to an existing path, the system SHALL throw an error whose example `git_path` value matches the host platform.

#### Scenario: Git found via Bun.which on Unix
- **WHEN** `resolveGit()` runs on macOS or Linux with `git` on `$PATH`
- **THEN** `Bun.which` returns the absolute path and that path is used

#### Scenario: Git found via Bun.which on Windows
- **WHEN** `resolveGit()` runs on Windows with `git.exe` on `%PATH%`
- **THEN** `Bun.which` returns the absolute path (using `;` as the PATH separator) and that path is used

#### Scenario: Windows fallback path used when not on PATH
- **WHEN** `resolveGit()` runs on Windows with no `git_path` configured and `git` not on PATH, but `C:\Program Files\Git\bin\git.exe` exists
- **THEN** the fallback path is used

#### Scenario: Error message uses platform-appropriate example
- **WHEN** `resolveGit()` cannot find git on Windows
- **THEN** the thrown error suggests `git_path: C:\\Program Files\\Git\\bin\\git.exe` rather than a Unix path

#### Scenario: Configured git_path takes priority on every platform
- **WHEN** `workspace.git_path` is set in `workspace.yaml`
- **THEN** that exact path is returned without consulting PATH or fallbacks

### Requirement: Worktree paths are valid on Windows
The system SHALL produce worktree paths that are valid on the host filesystem. Path construction SHALL use `path.join` (or template literals that resolve to filesystem-valid strings) and SHALL NOT assume `/` as the only valid separator.

#### Scenario: Worktree base path computed with platform separators
- **WHEN** `resolveWorktreeBase` computes a default worktree base on Windows
- **THEN** the resulting path is accepted by `git worktree add` (Node and Bun normalize `/` to `\` transparently on Windows)

#### Scenario: Worktree creation succeeds on Windows
- **WHEN** a task transitions out of Backlog on Windows
- **THEN** `git worktree add` is invoked with a Windows-valid path and the worktree is created at that path
