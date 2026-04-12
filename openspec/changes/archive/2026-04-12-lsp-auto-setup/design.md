## Context

The LSP tool (separate change) exposes code intelligence operations to AI agents, but requires language servers to be installed and configured up front. Today the burden falls entirely on the user: they must know which server to install, run the install command, and manually write the `lsp.servers` block in `workspace.yaml`. This friction prevents most users from enabling LSP at all.

Railyin already collects a project's path at registration time. A one-time scan of that path yields all the information needed to detect languages, check which servers are already installed, and automate the remaining setup — all without the user doing research.

## Goals / Non-Goals

**Goals:**
- Detect languages present in a project by scanning for well-known indicator files at the project root.
- Check whether the corresponding LSP server binary is already on `$PATH` (OS-agnostic probe via `which`/`where`).
- Present a UI prompt after project registration listing detected languages and setup options.
- Execute the selected install commands and stream output back to the UI.
- Automatically append the server definition to `workspace.yaml` on successful install (or if already installed).
- Support macOS, Linux, and Windows without platform-specific code paths in the feature logic.

**Non-Goals:**
- Not auto-starting or managing LSP server processes (that's the LSP tool's job).
- Not discovering language servers that are installed outside `$PATH` (e.g. project-local `node_modules/.bin`).
- Not supporting languages with no well-known stdio LSP server.
- Not re-running detection on existing projects (first registration only).
- Not enforcing any particular package manager — the registry offers options, user picks.

## Decisions

### 1. Static language registry in `src/bun/lsp/registry.ts`

A single exported constant defines all supported languages. Each entry contains:
- `name`: display name (e.g. "TypeScript / JavaScript")
- `detectionGlobs`: file patterns that indicate the language is in use (e.g. `tsconfig.json`, `*.ts`)
- `serverName`: the binary name for PATH probing (e.g. `typescript-language-server`)
- `extensions`: file extensions to route in `workspace.yaml`
- `installOptions`: array of `{ label, command, platforms }` — ordered by preference, each with a list of platforms it applies to (`"macos" | "linux" | "windows" | "*"`)

**Rationale**: A static registry is auditable, testable, easy to extend (one object per language), and keeps all platform knowledge in one place. Dynamic discovery of package managers would add complexity with little benefit — users have a preferred manager.

**Alternative considered**: Auto-detecting the best package manager on the system (e.g. check if `brew` exists, if `npm` exists) and auto-selecting the install command. Rejected because it silently picks a method the user may not want (e.g. installing a global npm package when the user prefers brew). Showing options in the UI is safer.

**Initial registry** (MVP — can be extended):

| Language | Indicator files | Server binary | Install options |
|---|---|---|---|
| TypeScript/JS | `tsconfig.json`, `package.json`, `*.ts`, `*.js` | `typescript-language-server` | npm (all), brew (macOS) |
| Python | `pyproject.toml`, `setup.py`, `requirements.txt`, `*.py` | `pyright-langserver` | npm (all), pip (all) |
| Rust | `Cargo.toml` | `rust-analyzer` | rustup (all), brew (macOS) |
| Go | `go.mod` | `gopls` | go install (all), brew (macOS) |
| Ruby | `Gemfile`, `*.gemspec` | `solargraph` | gem (all), brew (macOS) |

### 2. Binary probe via `spawnSync("which", [bin])` with Windows fallback to `where`

To check if a server is already installed, run `which <binary>` on macOS/Linux and `where <binary>` on Windows. Exit code 0 = installed.

**Rationale**: Universal, requires no dependencies, works in any shell environment. Does not require the server to actually start — just confirms the binary is accessible.

**Alternative considered**: Attempting to start the server in `--version` mode. Rejected because server startup flags are not standardised and some servers don't support `--version`.

### 3. Setup prompt is non-blocking: shown after project registration completes

The project is saved first. The LSP setup prompt appears as a follow-up step in the Add Project UI, not as a blocking gate. Users can dismiss it and configure LSP manually later.

**Rationale**: Failing to install a language server should never block a project from being registered. Decoupling the two steps means each has a clear success/failure state.

### 4. `workspace.yaml` entries written programmatically via js-yaml

On successful install (or if already present), the handler reads `workspace.yaml`, merges the new server entry into `lsp.servers` (deduplicating by `name`), and writes it back using `js-yaml`. Already-installed servers are also added to config if not present.

**Rationale**: js-yaml is already a dependency. Writing config programmatically avoids regex-based YAML mangling. Deduplication prevents double-entries if setup is re-triggered.

### 5. Install commands run via `run_command`-style `spawnSync` in the Bun handler

Install commands execute in the user's login shell (`sh -l -c` on macOS/Linux, `cmd /c` on Windows) so that PATH and shell profile modifications (e.g. `~/.cargo/env`) are respected.

**Rationale**: Package managers like `cargo`/`rustup` add to PATH only after sourcing their env file. A login shell ensures those are available.

## Risks / Trade-offs

- **Corporate/restricted environments** → Mitigation: all installs are opt-in; users can always skip and configure manually.
- **`$PATH` differs between login shell and app shell** → Mitigation: using login shell (`sh -l`) for both probe and install reduces discrepancy.
- **Indicator files give false positives** (e.g. a `package.json` in a non-TS project) → Mitigation: show detected languages in the UI before doing anything; user reviews before confirming.
- **Large projects with millions of files** → Mitigation: detection only checks the project root directory (depth 1), not recursive glob — fast and sufficient for indicator files.

## Open Questions

- Should the setup prompt be shown for the `lsp-tool` change as well, or gated behind the `lsp` workspace config being present? (Suggested: always show it — guides users to enable LSP.)
- Should existing projects get a "Set up LSP" button in project settings? (Out of scope for this change, but a natural follow-up.)
