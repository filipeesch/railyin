## Why

Chat sessions were designed to be scoped per workspace (the `chat_sessions.workspace_key` column exists since migration 026), but the frontend only loads sessions once at app startup with the initial workspace key. When the user switches workspaces, session data from the previous workspace bleeds into view — creating confusion where users see sessions from a different workspace's context.

This fix ensures the UI correctly isolates chat sessions per workspace, matching the backend's existing workspace-scoped filtering.

## What Changes

- **Reload chat sessions** when the active workspace changes via `workspaceStore.selectWorkspace()`
- **Close the active chat session** on workspace switch if it belongs to a different workspace (prevents orphaned sessions)
- **Normalize handler code** — use `fetchChatSessionWithModel()` consistently instead of raw SQL in `get`, `getMessages`, and `cancel` handlers
- **Extract `resolveWorkspaceKey()`** utility to reduce duplication of `params.workspaceKey ?? getDefaultWorkspaceKey()` pattern

No breaking API changes. No schema migrations needed. No new capabilities — this completes the existing workspace-scoping intent.

## Capabilities

### Modified Capabilities

- `chat-session`: Clarify that workspace scoping means each workspace has its own independent set of chat sessions, loaded fresh on workspace switch. Currently the DB schema and backend filter implement this, but the frontend reload was missing.

## Impact

| Area | Files Affected |
|------|----------------|
| Frontend store | `src/mainview/stores/workspace.ts` (inject chatStore dependency, call loadSessions + closeSession on switch) |
| Frontend bootstrap | `src/mainview/App.vue` (remove duplicate mount-time loadSessions call) |
| Backend handlers | `src/bun/handlers/chat-sessions.ts` (normalize get/getMessages/cancel; extract resolveWorkspaceKey) |
| Tests | Existing handler tests cover normalization; no new test files needed |
| Schema | None — `workspace_key` column already exists |
