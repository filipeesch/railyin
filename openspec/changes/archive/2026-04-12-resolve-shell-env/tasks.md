## 1. Core Module Implementation

- [x] 1.1 Create `src/bun/shell-env.ts` module with shell detection logic (detect shell via `$SHELL` → `userInfo().shell` → `/bin/sh`)
- [x] 1.2 Implement shell argument strategy function: map shell name to appropriate args (`['-i', '-l', '-c']` for bash/zsh, `['-ic']` for csh/tcsh)
- [x] 1.3 Implement shell environment spawn and JSON capture: spawn shell with UUID marker wrapper, capture stdout, extract JSON block, parse result
- [x] 1.4 Implement environment merge logic: merge resolved env into `process.env`, preserving app-set variables, allowing shell env to win for other keys
- [x] 1.5 Implement timeout mechanism: 10-second timeout with cancellation on shell process spawn, graceful fallback to existing env
- [x] 1.6 Implement caching: module-level promise variable so resolution is called once, subsequent calls await cached result

## 2. Integration and Startup

- [x] 2.1 Create `resolveShellEnv()` async export function in `shell-env.ts` that handles guard checks (skip if `RAILYN_CLI=1`, skip if Windows, skip if env already populated)
- [x] 2.2 Call `await resolveShellEnv()` in `src/bun/index.ts` early in startup, right after logging setup completes and before any other module initialization
- [x] 2.3 Add startup logging in `shell-env.ts`: log detected shell name, resolved PATH (sanitized), errors, and timeout warnings to `~/.railyn/logs/bun.log`

## 3. Configuration and Guards

- [x] 3.1 Update `package.json` dev scripts: set `RAILYN_CLI=1` in the `dev` command so `bun run dev` skips shell resolution overhead
- [x] 3.2 Update `electrobun.config.ts` if needed to ensure dev builds pass `RAILYN_CLI=1` through to the Bun process (verify current mechanism)
- [x] 3.3 Verify Windows code path: confirm shell resolution is skipped for `process.platform === 'win32'`

## 4. Testing

- [x] 4.1 Manual test on macOS: launch `.app` build and verify `~/.railyn/logs/bun.log` shows resolved PATH with homebrew/nvm/cargo paths
- [x] 4.2 Manual test on macOS: run `bun run dev` and verify `RAILYN_CLI` guard skips resolution (check startup logs for no shell-env messages)
- [x] 4.3 Manual test on Linux (if applicable): launch systemd/daemon context and verify resolution works
- [x] 4.4 Test timeout scenario: create a `.zshrc` that sleeps 15s, verify app times out gracefully and continues with existing env
- [x] 4.5 Test shell detection fallback: verify `$SHELL=/bin/false` falls back to `/bin/bash` (or configured fallback)
- [x] 4.6 Test with various shells: bash, zsh, fish (if installed) — verify correct args used
- [x] 4.7 Test `run_command` tool: from AI agent, run `npm test` or `rg pattern` and verify commands that live in `~/.nvm` or Homebrew are found
- [x] 4.8 Test LSP server launch: verify `typescript-language-server` or other nvm-managed server starts correctly

## 5. Documentation and Edge Cases

- [x] 5.1 Add code comments to `shell-env.ts` documenting the VS Code approach, why JSON.stringify is used, timeout rationale
- [x] 5.2 Document in `src/bun/index.ts` why `resolveShellEnv()` is called early and what it does
- [x] 5.3 Add troubleshooting note to README: if tools are still missing, user should check `~/.railyn/logs/bun.log` for shell resolution diagnostics
- [x] 5.4 Consider: make timeout configurable via `workspace.yaml` (e.g., `shell_env_timeout_ms: 15000`) — implement if time permits

