## Why

The "Browse" folder buttons on the Setup screen (workspace path, worktree base path, project path, git root path) do not work on Windows. Clicking Browse has no visible effect, leaving users unable to pick folders without typing paths manually.

## What Changes

- Fix the `workspace.openFolderDialog` backend handler so the native folder picker dialog appears correctly on Windows
- The dialog will open in front of the browser window (not hidden behind it)
- The dialog will pre-navigate to `initialPath` when provided (consistent with macOS and Linux behaviour)

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `workspace-folder-dialog`: Windows branch fixed — dialog now uses `-STA` threading flag required by WinForms, opens with a topmost owner window so it surfaces in front of the browser, and correctly initialises its selected path from the `initialPath` parameter

## Impact

- `src/bun/handlers/workspace.ts` — win32 branch of `workspace.openFolderDialog` only
- No frontend changes, no API contract changes
- macOS and Linux behaviour is untouched
