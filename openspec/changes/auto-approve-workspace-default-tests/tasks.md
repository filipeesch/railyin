## 1. Backend Unit Tests — workspace-handlers.test.ts

- [ ] 1.1 Add WH-1: `workspace.getConfig` returns `shellAutoApprove: false` when field is absent from yaml
- [ ] 1.2 Add WH-2: `workspace.getConfig` returns `shellAutoApprove: true` when `shell_auto_approve: true` is in yaml
- [ ] 1.3 Add WH-3: `workspace.getConfig` returns `shellAutoApprove: false` when `shell_auto_approve: false` is in yaml
- [ ] 1.4 Add WH-4: `workspace.update` with `shellAutoApprove: true` writes `shell_auto_approve: true` to yaml
- [ ] 1.5 Add WH-5: `workspace.update` with `shellAutoApprove: false` writes `shell_auto_approve: false` to yaml
- [ ] 1.6 Add WH-6: `workspace.update` with `shellAutoApprove` preserves all other existing yaml fields

## 2. Backend Integration Tests — handlers.test.ts (tasks.create)

- [ ] 2.1 Add TC-SA-1: task created with no workspace `shell_auto_approve` → `shellAutoApprove: false` (assert default)
- [ ] 2.2 Add TC-SA-2: task created with workspace `shell_auto_approve: true` → `shellAutoApprove: true` (use `setupTestConfig("shell_auto_approve: true", gitDir)` in nested describe)
- [ ] 2.3 Add TC-SA-3: task created with workspace `shell_auto_approve: false` → `shellAutoApprove: false` (explicit false)
- [ ] 2.4 Add TC-SA-4: after seeding ON, calling `tasks.setShellAutoApprove(false)` succeeds → task `shellAutoApprove: false` (independence)

## 3. Playwright UI Tests — workspace-settings.spec.ts

- [ ] 3.1 Update `makeWorkspace` factory in `e2e/ui/fixtures/mock-data.ts` to include `shellAutoApprove: false` default
- [ ] 3.2 Add W-9: "Auto-approve shell commands" toggle is visible in Workspace tab
- [ ] 3.3 Add W-10: toggle is unchecked when `workspace.getConfig` returns `shellAutoApprove: false`
- [ ] 3.4 Add W-11: toggle is checked when `workspace.getConfig` returns `shellAutoApprove: true`
- [ ] 3.5 Add W-12: enabling toggle and saving calls `workspace.update` with `shellAutoApprove: true`
- [ ] 3.6 Add W-13: disabling toggle and saving calls `workspace.update` with `shellAutoApprove: false`
