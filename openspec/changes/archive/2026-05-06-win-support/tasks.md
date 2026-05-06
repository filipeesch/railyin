## 1. Platform utilities module

- [x] 1.1 Create `src/bun/utils/platform.ts` exporting `getHomeDir()`, `getTmpDir()`, `getDataDir()`, `getPathDelimiter()`, `getDefaultShell()`, `getShellArgs(cmd)`, `getGitFallbacks()`, `isWindows()` — backed by `os.homedir()`, `os.tmpdir()`, `path.delimiter`, and platform branches
- [x] 1.2 Add `src/bun/test/platform.test.ts` with sanity checks (helpers return non-empty strings on the host platform; `getShellArgs("dir")` returns a 2-element array)

## 2. Replace `process.env.HOME` callers

- [x] 2.1 `src/bun/config/index.ts` — replace 3 occurrences of `process.env.HOME ?? "~"` with `getHomeDir()`. `getDataDir()` becomes a re-export of the helper from `platform.ts` (kept for back-compat with internal imports)
- [x] 2.2 `src/bun/db/index.ts::getDbPath` — replace HOME fallback with `getHomeDir()`
- [x] 2.3 `src/bun/engine/copilot/session.ts` — replace HOME fallback with `getHomeDir()`
- [x] 2.4 `src/bun/handlers/workspace.ts` — replace `process.env.HOME ?? "/tmp"` (used in `expandHome` and `initialPath` defaults) with `getHomeDir()`; change `workspacesRoot` default to use `getDataDir()`

## 3. Replace `/tmp/` literals

- [x] 3.1 `src/bun/index.ts:247` — `/tmp/railyn.port` → `join(getTmpDir(), "railyn.port")`
- [x] 3.2 `src/bun/index.ts:272` — `/tmp/railyn-debug.port` → `join(getTmpDir(), "railyn-debug.port")`
- [x] 3.3 (No change to e2e tests' `/tmp/railyn-test` literals — those are mock data strings, not real paths)

## 4. PTY migration to `node-pty`

- [x] 4.1 Rewrite `src/bun/launch/pty.ts::createPtySession` to use `import { spawn as ptySpawn } from "node-pty"` instead of `Bun.spawn` with `terminal:{}`. Wire `onData` → `dataListeners`, `onExit` → `exitListeners` + `markExited`. Use `getDefaultShell()` and `getShellArgs(command)` to assemble the spawn args
- [x] 4.2 Update `PtySession` interface to expose `write(data)`, `resize(cols, rows)`, `kill()` facade methods that delegate to the `IPty`. Remove the `terminal` and `proc` fields (they were Bun-specific handles)
- [x] 4.3 Update `src/bun/server/websocket.ts:64,68` — `session.terminal?.resize(...)` → `session.resize(...)`, `session.terminal?.write(...)` → `session.write(...)`
- [x] 4.4 Update `killAllPtySessions()` to call `session.kill()` (the facade) instead of `session.proc.kill()`
- [x] 4.5 Update `src/bun/test/server/websocket.test.ts:124` (`"pty message raw text forwards to terminal.write"`) to use the new facade — assert `session.write` is called instead of `session.terminal.write`
- [x] 4.6 Spot-check that `IPty.write` accepts `string` (it does, per node-pty types) and `IPty.onData` yields `string` chunks (yes — same type as the old `data(t, buf)` callback after `dec.decode`); remove the `TextDecoder` and `Buffer` plumbing that's no longer needed

## 5. Git resolution fix

- [x] 5.1 `src/bun/git/worktree.ts::resolveGit` — replace `[...].join(":")` with `[...].join(getPathDelimiter())`
- [x] 5.2 Replace inline `FALLBACK_GIT_PATHS` constant with `getGitFallbacks()` from `platform.ts` (Unix returns the existing array; Windows returns Git-for-Windows paths — see design D4)
- [x] 5.3 Add a unit test (or extend the worktree test) that verifies `resolveGit()` honors `workspace.git_path` when set and falls through to `Bun.which` when not

## 6. Launch / shell fixes

- [x] 6.1 `src/bun/launch/launcher.ts::launchApp` — replace `spawn("sh", ["-c", command], ...)` with `spawn(getDefaultShell(), getShellArgs(command), ...)`. The `shellEscape` helper stays for Unix; on Windows the cmd.exe behavior is acceptable for the simple `code .` / `cursor .` commands this is used with
- [x] 6.2 `src/bun/launch/code-server.ts::resolveCodeServerBinary` — replace `Bun.spawnSync(["which", "code-server"], ...)` with `Bun.which("code-server")` (already cross-platform)
- [x] 6.3 `src/bun/launch/terminal.ts::commandExists` — replace `spawnSync("which", [cmd])` with `Bun.which(cmd) !== null` so the Windows `wt` detection works
- [x] 6.4 `src/bun/handlers/launch.ts::launch.shell` — replace `process.env.SHELL ?? "/bin/bash"` with `getDefaultShell()`

## 7. `code-server` soft-disable on Windows

- [x] 7.1 `src/bun/launch/code-server.ts::startCodeServer` — early-return with `throw new Error("code-server is not supported on Windows")` when `isWindows()`. Update the handler in `src/bun/handlers/code-server.ts` so the error surfaces as a friendly RPC error
- [x] 7.2 Verify the frontend handles the error gracefully (the existing error-toast / panel handling should be sufficient — manual check, not a new feature)

## 8. Postinstall portability

- [x] 8.1 Create `scripts/postinstall.ts`:
  - `if (process.platform === "darwin")` chmod the `node-pty` `darwin-arm64/spawn-helper` binary to `0o755`
  - `if (process.platform !== "win32")` run the `code-server` postinstall (`Bun.spawn(["sh", "./postinstall.sh"], { cwd: "node_modules/code-server", env: { ...process.env, FORCE_NODE_VERSION: "20", npm_config_user_agent: "npm/10 node/v20.0.0 darwin arm64" } })`)
  - On Windows: log a one-line "skipped on Windows" notice
- [x] 8.2 Update `package.json::scripts.postinstall` to `bun scripts/postinstall.ts`
- [ ] 8.3 If `code-server`'s own `npm install` fails on Windows, move it to `optionalDependencies`. Verify with a fresh `bun install` on a clean Windows checkout (manual smoke)

## 9. Verification

- [x] 9.1 Run `bun test src/bun --timeout 20000` on macOS — all existing tests pass
- [ ] 9.2 Run `bun run build` and `bun run dev` on macOS — server starts, UI loads, can create a task and open the PTY (smoke that the node-pty migration didn't regress macOS)
- [ ] 9.3 Manual Windows smoke (one-time): `bun install && bun run build && bun run dev` on a Windows machine; verify server starts, UI loads, task creation works, worktree is created on transition to In Progress, PTY opens and runs `dir`, folder dialog appears
- [ ] 9.4 Confirm `code-server` panel shows a friendly unavailable message on Windows (not a crash)
