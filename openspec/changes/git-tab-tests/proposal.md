## Why

The `create-git-tab` change moves worktree management from the Info tab to a new Git tab. All existing Playwright tests in `worktree-management.spec.ts` currently target the Info tab; they must be re-targeted to the Git tab or they will break. Additionally, the new Git tab navigation itself has no test coverage.

## What Changes

- All 32 existing tests in `worktree-management.spec.ts` are updated: `openInfoTab` helper renamed to `openGitTab`, all `.task-tab-info` selectors replaced with `.task-tab-git`, tab button text changed from "Info" to "Git"
- New W-H suite added to `worktree-management.spec.ts` with 6 tests covering Git tab navigation, tab order, and regression guards (Info tab must not contain worktree section after the move)
- One new test (TD-8) added to `task-drawer.spec.ts` covering Git tab button presence and navigation

## Capabilities

### New Capabilities
- `git-tab-playwright-coverage`: Playwright test coverage for the new Git tab — navigation, tab order, worktree state display, create/delete flows, guard rails, and Info-tab regression guards

### Modified Capabilities
- `worktree-management-tests`: Existing W-A through W-G test suites re-targeted from Info tab to Git tab with updated selectors and navigation helper

## Impact

- **Modified files**: `e2e/ui/worktree-management.spec.ts`, `e2e/ui/task-drawer.spec.ts`
- **No production code changes** — test files only
- **Depends on**: `create-git-tab` change must be implemented first (provides `.task-tab-git` CSS class and Git tab button)
