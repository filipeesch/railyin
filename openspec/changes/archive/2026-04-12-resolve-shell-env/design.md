## Context

The app is bundled as a macOS `.app` bundle (Electrobun framework). When launched via Dock, Finder, or dmg, macOS provides only a minimal PATH (`/usr/bin:/bin:/usr/sbin:/sbin`), stripping all user-configured shell profile modifications (nvm, cargo, Homebrew, pyenv, etc.). This affects:

- **`run_command` tool**: AI shell commands fail to find tools (npm, python, custom CLIs)
- **LSP server launch** (`lsp/client.ts`): Language servers installed via package managers become invisible
- **External tool launch** (`launch/launcher.ts`): VS Code, editors, custom apps may not be found
- **Text search** (`rg` probe): ripgrep or other tools installed outside system paths are not found

When the app is launched from a terminal (`bun run dev`), the full environment is inherited correctly. Only the `.app` bundle form encounters the issue.

VS Code (open source, widely deployed) solved this by spawning the user's login shell at startup and capturing its environment JSON via their own Node binary, then merging into `process.env`. This is battle-tested across millions of users.

## Goals / Non-Goals

**Goals:**
- Capture and merge the full user shell environment at app startup (macOS and Linux `.app` launches)
- Automatic inheritance by all downstream process spawns with zero per-callsite changes
- Cross-platform approach (reuses VS Code's pattern, portable across shells: bash, zsh, fish, csh, tcsh)
- Diagnosability: log the resolved PATH and any errors
- Performance: ~100-300ms one-time cost at startup; skip if launched from CLI (terminal) where full env already present
- Timeout and graceful fallback: 10s timeout, continue with existing env if shell resolution fails

**Non-Goals:**
- Replicating full VS Code terminal emulation (we only need env vars, not tty)
- Installing missing tools automatically (e.g., downloading nvm if not present)
- Changing how tools are discovered or cached (Claude CLI, Copilot CLI already on-demand downloads)
- Windows-specific env resolution (Windows inherits env correctly from OS; only macOS/Linux `.app` bundles need this)

## Decisions

### 1. Shell Detection: Use `$SHELL` env var with fallback to `userInfo().shell` then `/bin/sh`

**Chosen**: `process.env.SHELL` → `os.userInfo().shell` → `/bin/sh`

**Rationale**: 
- `$SHELL` is reliably set even in `.app` context (inherited from user's account shell, not from terminal session)
- `userInfo().shell` reads `/etc/passwd` directly if `$SHELL` is unset (handles WSL and container edge cases)
- `/bin/sh` is always available as final fallback
- Avoids hardcoding `/bin/zsh` which may not match the user's configured shell

**Alternatives considered**:
- Hardcode `/bin/zsh`: simpler but breaks for bash users, tcsh, etc.
- Always try multiple shells in sequence: slower, unnecessary complexity

### 2. Shell Arguments: Use `-i -l -c` (interactive + login) to source all profiles

**Chosen**: `['-i', '-l', '-c']` for bash/zsh/fish; `['-ic']` for csh/tcsh

**Rationale**:
- `-l` (login) sources `/etc/profile`, `/etc/zprofile`, `~/.zprofile` → system PATH + macOS `path_helper` + Homebrew
- `-i` (interactive) sources `~/.bashrc` or `~/.zshrc` → nvm, cargo, pyenv, user-added paths
- Together they ensure full env capture that matches what the user sees in a normal terminal
- csh/tcsh don't support `-l` in the same way, so `-ic` is their equivalent

**Alternatives considered**:
- Just `-l`: misses nvm/cargo/pyenv which live in `.zshrc`
- Just `-c` (non-interactive, non-login): would miss most user paths entirely
- `sh -l -c`: insufficient on macOS; doesn't source `.zshrc` by default

### 3. Environment Capture: Spawn user shell, run Bun to JSON.stringify `process.env`, parse result

**Chosen**: Spawn `$SHELL -i -l -c 'process.execPath -e "console.log(MARKER + JSON.stringify(process.env) + MARKER)"'`

**Rationale**:
- Avoids parsing raw `env` output which is fragile (multiline values, special chars)
- Run Bun (bundled in `.app`) inside the shell so it inherits the sourced environment
- JSON.stringify ensures clean, parseable output
- MARKER UUID wraps the JSON output to strip shell noise (motd, warnings, etc.)
- Matches VS Code's battle-tested approach

**Alternatives considered**:
- `env | sort`: fragile to multiline values and special characters; slow parsing
- Read `.zprofile` and `.zshrc` manually: fragile to user customizations, doesn't handle dynamic modifications (shell functions, `path_helper`)
- Use `source ~/.zprofile && echo $PATH`: only gets PATH, not full env (NODE_VERSION, custom vars, etc.)

### 4. Guard: Skip resolution if `RAILYN_CLI=1` env var is set

**Chosen**: Check `process.env.RAILYN_CLI === '1'` early in startup; skip shell resolution if true

**Rationale**:
- Dev builds launched via `bun run dev` already inherit the full shell environment
- `.app` bundle (canary/stable) doesn't have `RAILYN_CLI` set, so resolution runs
- Zero overhead for dev loop (avoid ~100-300ms startup cost)
- Explicit and easy to test/debug

**Alternatives considered**:
- Check if `process.env.PATH` already contains typical homebrew paths: fragile heuristic
- Always run resolution: unnecessary latency for dev builds which already have full env
- Check parent process: complex, fragile across macOS versions

### 5. Cache: Single promise, resolve once, reuse result

**Chosen**: Module-level promise variable; first call awaits and caches, subsequent calls (if any) reuse

**Rationale**:
- Called once at startup, so caching is nice-to-have but not critical
- Prevents concurrent shell spawns if code paths call it multiple times
- Matches VS Code's pattern for simplicity

### 6. Merge Strategy: Shell env wins; preserve app-specific vars like `RAILYN_DATA_DIR`

**Chosen**: Merge shell env into `process.env` with shell values winning, but preserve app-set vars

**Rationale**:
- Users expect their shell customizations to take effect (PATH, NODE_VERSION, etc.)
- App vars like `RAILYN_DATA_DIR`, `RAILYN_DEBUG` (set before calling resolve) are preserved
- Avoids clobbering intentional app-level settings set at startup

### 7. Timeout: 10 seconds (configurable)

**Chosen**: 10s timeout with logged warning; continue with unresolved env if timeout

**Rationale**:
- Matches VS Code's default
- Long enough for most shell profile execution
- Prevents hanging the app on hung shell or very slow `.zshrc`
- Logged so user can diagnose and profile their shell startup

## Risks / Trade-offs

| Risk | Mitigation |
|------|-----------|
| **Slow `.zshrc` hangs the app** | 10s timeout with logged warning; user can diagnose in debug logs. Fallback is existing (stripped) env, app continues. |
| **User shell has errors or `exit 1`** | Catch spawn errors + handle non-zero exit codes; log clearly. App continues with existing env (not ideal but doesn't crash). |
| **Multiline env values confuse parsing** | JSON.stringify handles all edge cases; MARKER wrapping handles shell noise. Solid. |
| **App-specific env vars (RAILYN_DATA_DIR) get overwritten** | No — we merge shell env into `process.env`, shell values win, but app vars set before this call are preserved (depends on call timing). Set critical app vars *before* calling `resolveShellEnv()`. |
| **Different shell behavior in login vs. non-login context** | Intentional design choice. Captures the "user's real shell environment" which is login+interactive. |
| **`$SHELL` undefined in edge cases (containers, weird setups)** | Fallback to `userInfo().shell` then `/bin/sh`. Tested by VS Code across many environments. |

**Trade-offs:**
- **~100–300ms startup latency** (one-time): Worth the cost for correct tool visibility. Faster than downloading Claude CLI or Copilot binary.
- **Shell profile side effects**: If user has `echo` or other side effects in `.zshrc`, they'll run on app startup (once). Generally harmless for PATH-setting profiles. Can be mitigated with documentation (use init.zsh or env.zsh pattern, not .zshrc).

## Migration Plan

1. **Create module** `src/bun/shell-env.ts` with shell detection, spawn, JSON capture, merge logic, timeout
2. **Call early in startup**: Add `await resolveShellEnv()` in `src/bun/index.ts` (after logging setup, before any other module initialization)
3. **Set `RAILYN_CLI` in dev**: Update `package.json` scripts and Electrobun config to set `RAILYN_CLI=1` for dev builds
4. **Test on macOS and Linux**: Verify with various shells (zsh, bash); verify dev builds skip overhead; verify `.app` builds capture full env
5. **Log diagnostics**: Startup logs include final resolved PATH for debugging
6. **No breaking changes**: All existing code continues to work; downstream spawns automatically inherit the merged env

**Rollback**: Remove the call in `index.ts`, revert `package.json` scripts. No data migrations needed.

## Open Questions

1. **Should we make the 10s timeout configurable via workspace.yaml?** → Yes, good UX (users with slow shells can increase it)
2. **Should we log the full resolved `process.env` for debugging, or just PATH?** → Log PATH and summary stats; full env could be sensitive (API keys, tokens)

