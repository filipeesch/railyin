## Why

The `ChangedFilesPanel` component, which sits above the chat input in the task drawer, has three compounding problems that degrade the review experience:

1. **Panel is blind after agent commits**: `getGitStat` and `getChangedFiles` both run `git diff HEAD`, which returns empty once the agent commits its changes. The panel disappears and the user has no way to review anything — even though the agent made significant changes.

2. **All/Pending toggle is confusing noise**: The toggle was designed to switch between "pending review" and "all changed files" views. In practice it creates confusion about what "All" means (all files? all hunks?) and adds a button that doesn't belong in a review-oriented flow. Cursor and Copilot don't have this toggle.

3. **No bulk action buttons**: Users must open the overlay and manually accept/reject every hunk one by one even when they want to approve everything. Cursor and GitHub Copilot both offer "Accept All" / "Discard All" as first-class actions.

## What Changes

- **Store `base_sha`** at worktree creation time (the `HEAD` commit when `git worktree add` runs). All diff queries use `base_sha..HEAD` instead of just `HEAD`. This makes the panel accumulate all agent changes across commits and across sessions, showing only unreviewed hunks regardless of how many times the agent has committed.

- **Remove the All/Pending toggle**: The panel always shows pending-review files when any exist; when all hunks are decided it automatically switches to a "changed files" summary view with a "View Changes" button — exactly like Cursor.

- **Add Accept All / Reject All buttons** in the pending state header. These bulk-mark every pending hunk for the task as accepted or rejected without opening the overlay. The existing Review button remains for granular per-hunk review.

## Non-Goals

- This change does not alter the overlay's per-hunk accept/reject UX.
- This change does not auto-submit a review message to the agent on bulk accept/reject.
- This change does not affect the checkpoint/stash mechanism used for per-turn diffs inside the overlay.

## Capabilities

### Modified Capabilities
- `code-review`: Panel now driven by `base_sha..HEAD` diff so committed changes remain visible for review; bulk accept/reject actions added.
