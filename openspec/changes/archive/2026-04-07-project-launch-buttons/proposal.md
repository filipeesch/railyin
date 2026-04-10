## Why

Developers working on tasks in Railyin frequently need to launch their app (dev server, test runner, etc.) or open the task's worktree in their IDE — but currently have to leave Railyin and do it manually. A configurable launch button directly on the task card and chat panel eliminates this context-switch.

## What Changes

- **New config file** `railyin.yaml` at the project root defines run profiles (commands) and tools (IDE/app launchers), each with a label, icon, and command.
- **TaskCard** gains a SplitButton (or single Button) showing run profiles; tools appear as individual Buttons alongside.
- **TaskDetailDrawer conversation panel** gains the same run profile SplitButton and tool Buttons, identical to the card.
- **Backend** gains an RPC handler that launches a command in an external terminal, using the task's worktree path as CWD (falling back to project path if no worktree exists).
- **Terminal detection** is automatic per OS: macOS probes for iTerm2/Warp/Ghostty then falls back to Terminal.app; Windows probes for Windows Terminal then cmd.exe; Linux probes gnome-terminal, konsole, xfce4-terminal, kitty, then xterm.

## Capabilities

### New Capabilities
- `project-launch-config`: Per-project `railyin.yaml` config file defining run profiles and tool launchers (label, icon, command).
- `launch-external-process`: Backend capability to launch a command in a detected external terminal with a given CWD, cross-platform (macOS, Windows, Linux).
- `task-launch-buttons`: UI capability — SplitButton for run profiles and individual Buttons for tools, shown on TaskCard and TaskDetailDrawer conversation panel; hidden when no profiles/tools are configured.

### Modified Capabilities
- `project`: Projects now optionally associate with a `railyin.yaml` config file. The system reads this file to expose launch profiles and tools for tasks belonging to that project.

## Impact

- **New config format**: `railyin.yaml` at project root — version-controlled, per-project, not tracked by Railyin's database.
- **Frontend**: `TaskCard.vue`, `TaskDetailDrawer.vue` — new SplitButton and Button components from PrimeVue.
- **Backend**: New RPC handler for launching external processes; new config reader for `railyin.yaml`; OS-specific terminal detection logic.
- **RPC types**: New request/response types for reading launch config and executing launch.
- **No breaking changes** to existing workspace.yaml schema, database schema, or existing task/project behavior.
