## 1. Update worktree-management.spec.ts — re-target to Git tab

- [ ] 1.1 Rename `openInfoTab()` helper to `openGitTab()` and update it to click `.tab-btn:has-text("Git")` and await `.task-tab-git`
- [ ] 1.2 Replace all 32 `openInfoTab(` call sites with `openGitTab(`
- [ ] 1.3 Replace all `.task-tab-info` selector prefixes in W-A through W-G assertions with `.task-tab-git`
- [ ] 1.4 Update the file-level doc comment to reference "Git tab" instead of "Info tab"

## 2. Add W-H suite to worktree-management.spec.ts — navigation and regression guards

- [ ] 2.1 Add W-H-1: Git tab button is visible in the drawer toolbar
- [ ] 2.2 Add W-H-2: Clicking Git tab shows worktree content (`.task-tab-git` visible)
- [ ] 2.3 Add W-H-3: Tab order is Chat, Info, Git, Decisions (count + text assertions)
- [ ] 2.4 Add W-H-4: Info tab does NOT show a Worktree section for a ready task (regression guard)
- [ ] 2.5 Add W-H-5: Info tab does NOT show `.wt-create-form` for a not_created task (regression guard)
- [ ] 2.6 Add W-H-6: Delete confirmation is dismissed after switching away from Git tab and returning

## 3. Add TD-8 to task-drawer.spec.ts

- [ ] 3.1 Add TD-8: Drawer shows Git tab button and switching to it renders `.task-tab-git`
