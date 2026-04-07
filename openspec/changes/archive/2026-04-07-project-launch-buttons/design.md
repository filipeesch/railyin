## Context

Railyin tasks operate on git worktrees — isolated copies of the project. Developers frequently need to launch run commands (dev server, tests, build) or open their IDE against the worktree to inspect or test the agent's work. Currently this requires manually locating the worktree path and running commands outside Railyin, creating friction.

The app is built with Electrobun (Bun backend + WebView frontend via Vue/PrimeVue). The backend communicates with the frontend via a typed RPC system defined in `src/shared/rpc-types.ts`. Shell commands are already launched by the agent; this feature extends that to user-initiated launches in an external terminal.

## Goals / Non-Goals

**Goals:**
- Allow users to define run profiles and tool launchers per project in `railyin.yaml` at the project root.
- Surface a SplitButton (run profiles) and individual Buttons (tools) on the TaskCard and TaskDetailDrawer conversation panel.
- Launch the configured command in a detected external terminal with CWD set to the task's worktree path (or project path if no worktree exists).
- Cross-platform terminal detection: macOS, Windows, Linux — no user configuration required.

**Non-Goals:**
- Tracking the lifecycle of launched processes (no stop button, no output capture).
- Auto-detecting run profiles from `package.json`, `Makefile`, etc.
- Configuring preferred terminal app (auto-detect only).
- Launching processes inside Railyin's own terminal or conversation.

## Decisions

### Decision: Config lives in `railyin.yaml` at the project root

**Rationale**: Per-project config should be version-controlled alongside the project, not stored in Railyin's workspace config. This makes it portable across team members and machines.

**Alternative considered**: `workspace.yaml` — rejected because run profiles are project-specific and shouldn't be duplicated per-workspace.

**Alternative considered**: `.railyin.yaml` (dotfile) — rejected by user preference; `railyin.yaml` is cleaner and more visible.

### Decision: Profiles and tools share the same shape `{label, icon, command}`

**Rationale**: Keeps the config schema simple and uniform. The distinction between "profile" and "tool" is only semantic — profiles run in the worktree CWD, tools typically open an application at that path.

**Config format:**
```yaml
run:
  profiles:
    - label: "Dev"
      icon: "pi-play"
      command: "npm run dev"
    - label: "Test"
      icon: "pi-check-circle"
      command: "npm test"
  tools:
    - label: "VS Code"
      icon: "pi-code"
      command: "code ."
    - label: "Cursor"
      icon: "pi-bolt"
      command: "cursor ."
```

### Decision: CWD is implicit — always set to worktree path (or project path fallback)

**Rationale**: The vast majority of commands are meant to run in the project root. Making CWD implicit eliminates the need for variable substitution syntax (e.g., `$WORKTREE`). If a command needs a subdirectory, the user can express that in the command itself (`cd infra && docker compose up`).

**Fallback**: If `task.worktreePath` is null/undefined (worktree not yet created), use `project.projectPath`.

### Decision: Terminal detection is automatic, per OS, no user config

**Detection order:**
- **macOS**: `iTerm`, `Warp`, `Ghostty`, `Kitty` (via `/Applications/`) → fallback `Terminal.app` (always available)
- **Windows**: `wt` (Windows Terminal) → fallback `cmd.exe` (always available)
- **Linux**: `gnome-terminal`, `konsole`, `xfce4-terminal`, `kitty`, `xterm` (via `which`) → xterm as last resort

Detection runs at startup or lazily on first launch. Result is cached in memory for the session.

**Launching strategy:**
- macOS: `open -a "<TerminalApp>" --args <script>` or `osascript` for Terminal.app/iTerm2.
  - For terminals that support it, pass the command via their CLI flags (e.g., `warp --working-directory <path> -- <command>`).
  - Fallback: write a temp shell script, launch terminal opening it.
- Windows: `wt -d <cwd> cmd /k "<command>"` or `start cmd /k "cd <cwd> && <command>"`.
- Linux: terminal-specific flags (`gnome-terminal --working-directory=<cwd> -- bash -c "<command>"`, etc.).

### Decision: SplitButton for profiles, individual Buttons for tools — same in card and drawer

**Rationale**: Run profiles have a natural "primary" action (the first profile) that justifies SplitButton. Tools are independent actions of equal weight, so flat buttons are appropriate.

**Visibility rules:**
- 0 profiles → profile button hidden
- 1 profile → plain `<Button>` (no dropdown arrow)
- 2+ profiles → `<SplitButton>` (first profile = main button, rest in dropdown)
- 0 tools → tool buttons hidden
- N tools → N individual `<Button>` components

### Decision: `railyin.yaml` is read on-demand via RPC — not stored in DB

**Rationale**: The file is the source of truth. No sync needed. Backend reads it fresh when the frontend requests launch config for a task. Caching per session is fine.

**RPC shape:**
```typescript
"launch.getConfig": {
  params: { taskId: number };
  response: LaunchConfig | null;  // null if railyin.yaml not found or has no run section
}

"launch.run": {
  params: { taskId: number; command: string };
  response: { ok: true };
}
```

## Risks / Trade-offs

- **railyin.yaml not found** → buttons simply don't appear. No error shown. This is the correct UX — projects that haven't opted in are unaffected.
- **Terminal not found on Linux** → xterm is so ubiquitous it's a safe last resort; if even that fails, show a toast error.
- **Command injection** → Commands come from a YAML file the user controls in their own repo, not from untrusted input. No additional sanitization needed beyond what the shell provides, but commands are NOT passed through a shell interpreter — they are launched directly with args split by whitespace, preventing injection from external sources.
- **macOS: osascript complexity** → Terminal.app and iTerm2 require AppleScript. This is unavoidable and well-documented. Keep the AppleScript strings minimal and isolated in a dedicated utility.
- **Worktree path race** → If user clicks launch while worktree is being created, projectPath fallback is used. Acceptable.

## Migration Plan

No migration needed. No database changes. No breaking changes to existing config formats. The feature is purely additive — projects without `railyin.yaml` are unaffected.
