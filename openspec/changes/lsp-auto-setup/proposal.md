## Why

The LSP tool requires language servers to be installed and configured in `workspace.yaml` before any AI agent can use code intelligence. Today that setup is entirely manual — users must know which servers exist, install them, and write the YAML config by hand. When a project is first registered, Railyin already knows the project path, so it has everything needed to detect languages and guide setup without user research overhead.

## What Changes

- When a project is registered, Railyin scans the project root for language indicator files (e.g. `tsconfig.json`, `Cargo.toml`, `pyproject.toml`, `go.mod`) to build a list of detected languages.
- For each detected language, the system checks whether the corresponding LSP server binary is already on `$PATH` using a cross-platform discovery mechanism.
- A setup prompt is shown in the UI listing detected languages, whether their server is already installed, and a recommended install command — users opt in per language.
- Install commands are executed as shell commands in the project's working directory; output is streamed back to the UI.
- On successful install (or if the server was already present), the server definition is appended to the project's `workspace.yaml` `lsp.servers` array automatically.
- All language-to-server mappings, install methods, and detection globs are defined in a static, OS-aware registry built into Railyin — no hardcoded platform assumptions.

## Capabilities

### New Capabilities
- `lsp-language-registry`: A static registry mapping language names to detection globs, LSP server metadata, and OS-agnostic install strategies (supports `npm`, `cargo`, `go install`, `pip`, `gem`, `brew`, `apt`, `winget` with fallback priority).
- `lsp-auto-setup`: The project-registration flow extension that detects languages, probes for installed binaries, shows a setup prompt, runs installs, and writes `workspace.yaml` entries.

### Modified Capabilities
- `project`: Project registration gains an optional post-add LSP setup step surfaced in the `add project` UI flow.

## Impact

- New: `src/bun/lsp/registry.ts` — language/server registry
- New: `src/bun/handlers/lsp-setup.ts` — detection, probe, install, config-write logic
- Modified: project add handler and frontend `AddProject` view to trigger and display setup prompt
- Modified: `workspace.yaml` schema to accept auto-written `lsp.servers` entries
- Dependencies: no new npm packages — uses `spawnSync` for binary probing and install execution
