## 1. Language Registry

- [x] 1.1 Create `src/bun/lsp/registry.ts` with the `LanguageEntry` type: `name`, `detectionGlobs`, `serverName`, `extensions`, `installOptions: { label, command, platforms }[]`
- [x] 1.2 Add TypeScript/JS entry: globs `tsconfig.json`, `package.json`, `*.ts`, `*.tsx`; server `typescript-language-server`; install options: `npm install -g typescript typescript-language-server` (*), `brew install typescript-language-server` (macos)
- [x] 1.3 Add Python entry: globs `pyproject.toml`, `setup.py`, `requirements.txt`, `*.py`; server `pyright-langserver`; install options: `npm install -g pyright` (*), `pip install pyright` (*)
- [x] 1.4 Add Rust entry: globs `Cargo.toml`; server `rust-analyzer`; install options: `rustup component add rust-analyzer` (*), `brew install rust-analyzer` (macos)
- [x] 1.5 Add Go entry: globs `go.mod`; server `gopls`; install options: `go install golang.org/x/tools/gopls@latest` (*), `brew install gopls` (macos)
- [x] 1.6 Add Ruby entry: globs `Gemfile`, `*.gemspec`; server `solargraph`; install options: `gem install solargraph` (*), `brew install solargraph` (macos)
- [x] 1.7 Export a `getRegistryForPlatform(platform: NodeJS.Platform): LanguageEntry[]` helper that filters each entry's `installOptions` to only those matching the current platform

## 2. Language Detection

- [x] 2.1 Create `src/bun/lsp/detect.ts` with `detectLanguages(projectPath: string): LanguageEntry[]` — reads the project root directory (depth 1 only, no recursion) and returns registry entries whose `detectionGlobs` match any file present
- [x] 2.2 Implement glob matching using `micromatch` or simple `endsWith`/`===` checks (no recursive walk needed — root only)
- [x] 2.3 Add `probeInstalled(serverName: string): boolean` — runs `which <binary>` on macOS/Linux and `where <binary>` on Windows via `spawnSync`; returns true when exit code is 0

## 3. Install Execution

- [x] 3.1 Create `src/bun/lsp/installer.ts` with `runInstall(command: string, cwd: string): AsyncGenerator<string>` — spawns `sh -l -c <command>` (macOS/Linux) or `cmd /c <command>` (Windows), yields stdout/stderr lines as they arrive
- [x] 3.2 Add RPC handler `lsp.runInstall` in `src/bun/handlers/` that receives `{ command, projectPath }`, streams lines back as progress events, and resolves with `{ success: boolean, output: string }`
- [x] 3.3 Ensure the handler rejects commands that contain shell metacharacters beyond what the install registry defines (basic allowlist validation — no user-supplied arbitrary commands)

## 4. workspace.yaml Config Writer

- [x] 4.1 Create `src/bun/lsp/config-writer.ts` with `addServerToConfig(workspaceYamlPath: string, entry: LanguageEntry): void` — reads the YAML, merges into `lsp.servers` deduplicating by `name`, writes back via `js-yaml`
- [x] 4.2 Handle the case where `lsp` or `lsp.servers` keys don't yet exist in workspace.yaml (create the path)
- [x] 4.3 Preserve existing YAML content and comments as much as possible (use `js-yaml` dump with `lineWidth: -1`)

## 5. Backend Handler — LSP Setup Flow

- [x] 5.1 Add RPC handler `lsp.detectLanguages` that accepts `{ projectPath: string }` and returns `DetectedLanguage[]` — each with `entry: LanguageEntry`, `alreadyInstalled: boolean`, platform-filtered `installOptions`
- [x] 5.2 Add RPC handler `lsp.addToConfig` that accepts `{ projectPath: string, languageServerName: string }` and writes the server entry to workspace.yaml without running an install
- [x] 5.3 Register both handlers in the bun handler index

## 6. Frontend — LSP Setup Prompt Component

- [x] 6.1 Create `src/mainview/components/LspSetupPrompt.vue` — receives `detectedLanguages: DetectedLanguage[]` as prop, shows a card per language with name, install status badge, and install option selector (radio/select for multiple options)
- [x] 6.2 Add "Install" button per language that calls `lsp.runInstall` and streams progress into an inline terminal-style output area
- [x] 6.3 Add "Add to config only" option for already-installed servers (calls `lsp.addToConfig`)
- [x] 6.4 Show success/error state per language after install attempt; on success, automatically call `lsp.addToConfig`
- [x] 6.5 Add "Skip" / "Done" button to dismiss the prompt

## 7. Frontend — Integration with Add Project Flow

- [x] 7.1 After a project is saved successfully in the Add Project flow, call `lsp.detectLanguages` with the new project's path
- [x] 7.2 If detected languages array is non-empty, show `LspSetupPrompt` as a follow-up step (not a blocking modal — project is already saved)
- [x] 7.3 If detected languages array is empty, skip the LSP step and complete the add-project flow as before

## 8. Tests

- [x] 8.1 Unit test `detectLanguages`: fixture dir with `tsconfig.json` → detects TypeScript; empty dir → empty result; indicator in subdirectory only → not detected
- [x] 8.2 Unit test `probeInstalled`: mock `spawnSync` returning exit 0 → true; exit 1 → false; Windows code path uses `where`
- [x] 8.3 Unit test `addServerToConfig`: new yaml gets `lsp.servers` created; existing entry not duplicated; existing yaml content preserved
- [x] 8.4 Unit test `getRegistryForPlatform`: macOS returns brew options; linux does not; `*` platform options appear on all
