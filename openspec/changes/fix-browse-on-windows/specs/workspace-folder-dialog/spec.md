## MODIFIED Requirements

### Requirement: Windows folder picker opens in foreground
The system SHALL open a native folder picker dialog that is visible and interactive on Windows when `workspace.openFolderDialog` is called.

The implementation SHALL spawn `powershell.exe` with the `-STA` flag, create a topmost owner `System.Windows.Forms.Form`, and call `ShowDialog($owner)` so the dialog surfaces in front of the calling application.

#### Scenario: Browse button clicked on Windows
- **WHEN** the user clicks a Browse button on the Setup screen on Windows
- **THEN** the native Windows folder browser dialog SHALL appear in the foreground, focused and interactive

#### Scenario: Dialog dismissed with Cancel
- **WHEN** the user cancels the folder picker dialog
- **THEN** the system SHALL return `{ path: null }` and leave the path field unchanged

#### Scenario: Dialog confirmed with a folder selection
- **WHEN** the user selects a folder and confirms
- **THEN** the system SHALL return `{ path: "<selected absolute path>" }` and update the corresponding path field

### Requirement: initialPath applied on Windows
The system SHALL pre-navigate the Windows folder picker to `initialPath` when provided, matching the behaviour already present on macOS and Linux.

The `initialPath` value SHALL be passed via the `RAILYN_INITIAL_PATH` environment variable (not inline in the command string) to avoid injection issues with paths containing quotes or special characters.

#### Scenario: initialPath provided
- **WHEN** `workspace.openFolderDialog` is called with a valid `initialPath`
- **THEN** the dialog SHALL open with that path already selected/visible

#### Scenario: initialPath not provided
- **WHEN** `workspace.openFolderDialog` is called without `initialPath`
- **THEN** the dialog SHALL open at the user's home directory
