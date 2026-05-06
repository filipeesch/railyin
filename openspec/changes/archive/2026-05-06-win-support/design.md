## Context

Railyin's Bun backend was written for macOS/Linux and accumulated Unix-specific patterns: `/tmp/`, `process.env.HOME`, `/bin/sh`, `which`, and the Bun-native PTY (`Bun.spawn` with `terminal:{}` callbacks). Bun for Windows has been GA for some time; the only remaining work is to remove or branch the Unix-only assumptions in Railyin's own code.

A full audit identified ~12 files with platform-sensitive code. About half already branch on `process.platform === "win32"` (e.g. `lsp/installer.ts`, `lsp/detect.ts`, `launch/terminal.ts::detectWindows`, `handlers/workspace.ts` PowerShell folder dialog). The remaining files unconditionally use Unix paths/binaries and need to be reworked.

## Goals / Non-Goals

**Goals:**
- Railyin starts and serves the UI on Windows when launched as `bun run dev` (with Bun, git, and Node available on PATH).
- Core flows work: create task, transition to In Progress (worktree creation), open task PTY, browse for folder.
- A single module owns all `process.platform` branching; new code added later inherits the pattern.
- macOS and Linux behavior is unchanged.

**Non-Goals:**
- Cross-platform CI matrix.
- Windows-specific tests.
- `code-server` working on Windows (not feasible without significant additional work — soft-disable is acceptable).
- Path normalization for paths shown in the UI (existing UI strings can keep mixed separators; Node/Bun handle both).

## Decisions

### D1: Single platform-utils module — `src/bun/utils/platform.ts`

**Decision**: Create `src/bun/utils/platform.ts` exporting:

```ts
export function getHomeDir(): string;          // os.homedir()
export function getTmpDir(): string;           // os.tmpdir()
export function getDataDir(): string;          // RAILYN_DATA_DIR ?? join(getHomeDir(), ".railyn")
export function getPathDelimiter(): string;    // path.delimiter (":" or ";")
export function getDefaultShell(): string;     // SHELL or COMSPEC fallback
export function getShellArgs(cmd: string): string[]; // ["-c", cmd] or ["/c", cmd]
export function getGitFallbacks(): string[];   // platform-specific candidates
export function isWindows(): boolean;          // process.platform === "win32"
```

**Rationale**: Every other file in `src/bun/` should remain platform-agnostic. The only `process.platform` reads in production code (after this change) live in `platform.ts`. This makes future cross-platform code a one-import affair and keeps the audit surface tiny.

**Note on `getDataDir()`**: an identical function already exists in `config/index.ts`. The new one *replaces* the old; `config/index.ts` re-exports it for backward compat with the public-facing import path.

**Alternative considered — inline `os.homedir()` everywhere**: rejected because the pattern (`process.env.HOME ?? "~"`) is already duplicated 5 times. A repeated pattern with a known wrong fallback (`"~"` is a literal tilde, never resolved) is exactly what a helper exists to solve.

**Alternative considered — set `process.env.HOME = os.homedir()` at startup**: rejected because it mutates a global, can surprise tests, and `HOME` is not a Windows convention — third-party tools spawned by Railyn may misbehave.

---

### D2: Full PTY migration to `node-pty`

**Decision**: Replace the Bun-native PTY (`Bun.spawn` + `terminal:{ cols, rows, data, exit }` callbacks) with `node-pty` on **all** platforms. `node-pty` v1.1 is already in `package.json` dependencies.

```
BEFORE                                 AFTER
─────────────────────                  ──────────────────────────────
Bun.spawn(["/bin/sh","-c",cmd], {      pty.spawn(shell, args, {
  terminal: {                            cols: 120, rows: 30,
    cols, rows,                          cwd, env,
    data(t, buf) { ... },              })
    exit(t, code) { ... },             ipty.onData(s => ...)
  },                                   ipty.onExit(({exitCode}) => ...)
  cwd, env,                            ipty.kill(); ipty.write(s); ipty.resize(c,r)
});
```

**API changes to `PtySession`**:

```ts
interface PtySession {
  id: string;
  cwd: string;
  command: string;
  scrollback: string;
  exited: boolean;
  dataListeners: Set<(chunk: string) => void>;
  exitListeners: Set<(exitCode: number) => void>;
  // Was: terminal (Bun handle), proc (Bun.Subprocess)
  // Now: facade methods that delegate to the underlying node-pty IPty
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
}
```

**Caller impact** — `src/bun/server/websocket.ts:64,68`:

```ts
// before
session.terminal?.resize(parsed.cols, parsed.rows);
session.terminal?.write(text);
// after
session.resize(parsed.cols, parsed.rows);
session.write(text);
```

**Rationale**:
- `node-pty` is the de-facto cross-platform PTY (used by VS Code, Hyper, etc.) — ConPTY on Windows, openpty on Unix.
- A single code path simplifies maintenance vs. branching inside `pty.ts` between Bun-native and node-pty.
- The Bun-native `terminal:{}` API is Unix-only and may not be a long-term Bun direction; relying on a third-party module that targets Bun via Node-API is more durable.
- `node-pty` already has a working `darwin-arm64` prebuild (the current postinstall `chmod +x`-es its `spawn-helper`). Windows prebuilds ship with the npm package.

**Risk**: native addon can fail to load on uncommon Linux distros. Same risk exists today for the macOS prebuild — accept as no-regression.

---

### D3: `os.tmpdir()` for port files

**Decision**: `Bun.write("/tmp/railyn.port", ...)` → `Bun.write(join(getTmpDir(), "railyn.port"), ...)`.

**Impact**: The port files are written by `index.ts` for external discoverability but are **not read by the e2e Playwright suite** (Playwright resolves its own port via the webServer config). No test code change is required for this decision.

**Rationale**: `os.tmpdir()` is the idiomatic cross-platform tmp dir and resolves to `%TEMP%` on Windows.

---

### D4: Git resolution in `worktree.ts`

**Decision**:
- Replace `[...].join(":")` with `[...].join(path.delimiter)`.
- Move `FALLBACK_GIT_PATHS` into `getGitFallbacks()` from `platform.ts` so the array is platform-aware:
  - **Unix**: `/usr/bin/git`, `/usr/local/bin/git`, `/opt/homebrew/bin/git`
  - **Windows**: `C:\Program Files\Git\bin\git.exe`, `C:\Program Files (x86)\Git\bin\git.exe`, `C:\Program Files\Git\cmd\git.exe`

**Rationale**: `Bun.which` already does cross-platform PATH lookup. The PATH separator and Windows fallback paths are the only real bugs; the Unix fallback array is belt-and-suspenders for users whose shell PATH wasn't propagated to the spawned process.

---

### D5: `code-server` soft-disabled on Windows

**Decision**: `code-server.ts::startCodeServer` returns `{ error: "code-server is not supported on Windows" }` (or throws a typed error) when `isWindows()`. The existing `code-server` npm dependency can stay; the postinstall step skips it on Windows.

**UX implication**: The "Open in code-server" button in the UI surfaces a friendly notice instead of opening a blank panel. `launchApp("code .", cwd)` continues to work on Windows for users who have VS Code installed.

**Rationale**: `code-server` is fundamentally a Linux/macOS tool — it shells into a Node binary that expects POSIX paths and signals. Adapting it is out of scope. Soft-disable preserves the rest of Railyin's value on Windows.

---

### D6: `postinstall` rewritten as `scripts/postinstall.ts`

**Decision**: Move the inline shell pipeline out of `package.json` into `scripts/postinstall.ts`:

```ts
// Pseudocode — exact in tasks.md
if (process.platform === "darwin") {
  await chmod("node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper", 0o755);
}
if (process.platform !== "win32") {
  await runCodeServerPostinstall();
}
// Windows: no-op
```

`package.json` becomes: `"postinstall": "bun scripts/postinstall.ts"`.

**Rationale**: The current postinstall mixes `chmod`, `&&`, subshells, and an `sh ./postinstall.sh` invocation — none of which work in Windows `cmd.exe`. A Bun script is portable. It also gives us a clean place to hang future post-install logic (e.g. probing for git on Windows).

---

### D7: `expandHome` fallback uses `getTmpDir()`

`handlers/workspace.ts::expandHome` currently falls back to `/tmp` when `HOME` is unset. With `getHomeDir()` from `platform.ts`, the fallback becomes unnecessary (`os.homedir()` always returns a valid path), but defensive callers that pass `process.env.HOME || "/tmp"` should switch to `getHomeDir()` directly.

## Risks / Trade-offs

### R1: `node-pty` on Bun for Windows

**Risk**: `node-pty` requires its native addon to load. Bun's Node-API support is generally good but not byte-for-byte identical to Node. The Windows prebuild for `node-pty` v1.1 is built against Node-API — should work on Bun, but worth a manual smoke before merging.

**Mitigation**: Run `bun install && bun run dev` on a Windows machine (or VM) once before merging. If `node-pty` fails to load, fall back to a `child_process.spawn`-based PtySession that streams raw stdout (degraded UX — no resize, ANSI color may misbehave).

### R2: `code-server` `npm install` failures on Windows

**Risk**: The `code-server` npm package may itself fail to install on Windows even if its postinstall is skipped — its own native deps might not have Windows prebuilds.

**Mitigation**: If `bun install` fails on Windows, conditionally exclude `code-server` from `dependencies` via a separate `optionalDependencies` block, or move it to a `peerDependenciesMeta` flag. Last resort: document a manual `bun install --no-optional` workflow on Windows.

### R3: Path separator leakage in stored config

**Risk**: Workspace `worktree_base_path` and `workspace_path` may have been stored with `/` separators by Unix users. On Windows these still work because Node accepts `/` as a separator universally — but UI strings displayed to Windows users may look foreign. Acceptable for v1.

### R4: Git for Windows shipping `bash.exe`

**Risk**: Git for Windows installs include `bash.exe`. If Railyin's `getDefaultShell()` happens to detect that as `SHELL`, Windows users could end up with mismatched shell semantics. The decision tree in `getDefaultShell()`:

```
1. process.env.SHELL (only set in some Win shells like Git Bash)
2. process.platform === "win32" → "cmd.exe"
3. process.env.COMSPEC (Windows fallback to cmd.exe path)
4. /bin/sh (final Unix fallback)
```

Acceptable: Git Bash users explicitly opted into bash semantics by setting `SHELL`.

## Migration Plan

This is an internal refactor — no migration of user data. After deploying:

1. macOS / Linux users: zero-impact. Same behavior.
2. Windows users (new): `bun install` works (postinstall is now Windows-aware). `bun run dev` starts the server. Core flows work; `code-server` shows a friendly unavailable notice.

## Open Questions

- **Q1**: Does `bun:sqlite` have any Windows-specific path quirks? (Likely no — Bun handles this — but worth confirming during the manual smoke.)
- **Q2**: The current `handlers/workspace.ts::launchPath` (not seen in this audit) — does it have any other Unix-only patterns? Spot check during implementation.
- **Q3**: Should the `dev:kill` npm script (`pkill -f 'src/bun/index.ts'`) get a Windows variant? Low priority — power-user dev script. Could replace with a Bun script that uses `Bun.spawn(["taskkill", "/f", "/im", "bun.exe"])` on Windows. Defer.
