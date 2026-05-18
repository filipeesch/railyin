## Context

The Setup screen has "Browse" buttons to pick workspace path, worktree base path, project path, and git root path. These call `workspace.openFolderDialog` on the backend. On macOS and Linux the implementation works correctly (osascript / zenity). The Windows (win32) branch had three bugs: it spawned PowerShell without the `-STA` flag required for WinForms UI, it had no owner window so the dialog opened behind the browser and was invisible, and it ignored `initialPath` entirely.

## Goals / Non-Goals

**Goals:**
- Windows folder-picker dialog appears in the foreground when Browse is clicked
- Dialog pre-navigates to `initialPath` when provided
- No regression on macOS or Linux

**Non-Goals:**
- Replacing native OS dialogs with a frontend folder browser
- Supporting PowerShell 7 (`pwsh.exe`) specifically — Windows PowerShell 5.1 (`powershell.exe`) is sufficient and ships on all supported Windows versions

## Decisions

### Use `-STA` flag on powershell.exe
WinForms dialogs (`FolderBrowserDialog`, `OpenFileDialog`, etc.) require a Single-Threaded Apartment (STA) COM thread. Without `-STA`, `ShowDialog()` either throws or returns immediately with no UI. Adding `-STA` to the spawn arguments is the minimal, correct fix.

**Alternatives considered:** Switching to `pwsh.exe` — rejected because it is an optional install and `-STA` works fine in 5.1.

### Topmost owner Form to surface the dialog
Windows focus-stealing prevention keeps dialogs spawned from background processes (like the Bun server) hidden behind other windows. Creating a zero-size topmost `Form` and passing it as the owner to `ShowDialog($owner)` forces the dialog into the foreground without permanently stealing focus.

**Alternatives considered:** `$dialog.BringToFront()` — not available on dialogs; `[System.Windows.Forms.Application]::SetCompatibleTextRenderingDefault` — unrelated. The owner Form pattern is the idiomatic WinForms solution.

### Pass initialPath via environment variable
The `initialPath` string can contain backslashes, spaces, and single/double quotes — all characters that are dangerous to embed into an inline PowerShell command string. Passing via `RAILYN_INITIAL_PATH` env var and reading with `$env:RAILYN_INITIAL_PATH` eliminates the injection surface entirely.

**Alternatives considered:** Escaping the path inline — fragile and error-prone on Windows paths.

## Risks / Trade-offs

- **[Risk] powershell.exe not on PATH** → Mitigated: `powershell.exe` ships with all supported Windows versions and is always on PATH; this is no worse than the current state.
- **[Risk] Owner Form briefly flashes** → In practice the Form is invisible (0×0, never shown), so no visual artifact occurs.

## Migration Plan

Single-file change already committed. No migration needed — no data model, config, or API contract changes. Rollback: revert the one-line spawn call.
