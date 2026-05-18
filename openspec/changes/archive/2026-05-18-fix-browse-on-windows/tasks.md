## 1. Backend Fix

- [x] 1.1 Add `-STA` flag to `powershell.exe` spawn in `workspace.openFolderDialog` win32 branch
- [x] 1.2 Create a topmost owner `Form` and pass it to `ShowDialog($owner)` so the dialog surfaces in the foreground
- [x] 1.3 Read `initialPath` (defaulting to home dir) and bind to `$d.SelectedPath` via `RAILYN_INITIAL_PATH` env var

## 2. Verification

- [ ] 2.1 Manually verify Browse buttons on Setup screen open the folder picker in foreground on Windows
- [ ] 2.2 Verify dialog pre-navigates to `initialPath` when a path is already set
- [ ] 2.3 Verify Cancel returns null and leaves path fields unchanged
- [x] 2.4 Confirm macOS and Linux behaviour is unaffected (no regression)
- [x] 2.5 Run backend test suite (`bun test src/bun/test --timeout 20000`) and confirm no new failures
