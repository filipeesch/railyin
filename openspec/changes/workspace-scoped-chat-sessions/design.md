## Context

Chat sessions have a `workspace_key` column since migration 026 (created alongside the chat_sessions table). The backend handler `chatSessions.list` already filters by `workspace_key`. The frontend store accepts a `workspaceKey` parameter for `loadSessions()` and `createSession()`.

However, `App.vue` calls `loadSessions(workspaceStore.activeWorkspaceKey)` only once in `onMounted`. When the user switches workspaces via the workspace tabs in `BoardView.vue`, no chat session reload occurs — sessions from the previous workspace remain visible.

```
CURRENT FLOW:                                    BROKEN STATE:
App.vue onMounted                                 Mount: sessions = [wsA: 1, 2]
    │
    ├─ workspaceStore.loadWorkspaces()            User clicks wsB tab
    ├─ workspaceStore.load()                       │
    ├─ chatStore.loadSessions(wsA) ◀── only ONCE  ─┼─ ❌ Still shows wsA sessions
    │                                              │
BoardView.onWorkspaceChange(wsKey)                 BoardView.onWorkspaceChange(wsKey)
    │                                                  ├─ selectWorkspace(wsB) → activeWorkspaceKey = wsB
    ├─ selectWorkspace(key)                           └─ selectFirstBoardInWorkspace(wsB)
    │                                                    ❌ NO chat session reload
    ├─ loadEnabledModels(key)                        Sidebar still shows wsA sessions!
    └─ selectFirstBoardInWorkspace(key)
```

The workspace store has no dependency on any other store currently. `task.ts` imports `useWorkspaceStore` but not the reverse. This would be the first cross-store dependency in this direction.

## Goals / Non-Goals

**Goals:**
- Load chat sessions fresh from the server when the active workspace changes
- Close the active chat session if it belongs to a different workspace (orphan cleanup)
- Normalize redundant code in chat session handlers
- Extract shared utility for workspace key resolution

**Non-Goals:**
- Backend enforcement of workspace ownership on mutations (out of scope, no multi-tenant concern)
- Persistent session ID across workspace switches (user re-clicks to re-select)
- Schema migrations or API contract changes
- E2E test coverage (handled separately)

## Decisions

### D1: Inject `useChatStore` into `workspaceStore.selectWorkspace()`

**Chosen:** Import `useChatStore` inside the workspace store's `defineStore` callback and call `loadSessions(key)` + `closeSession()` whenever `activeWorkspaceKey` changes.

**Why:** `selectWorkspace()` is the single entry point for ALL workspace switches (triggered from `BoardView.onWorkspaceChange`, `SetupView`, and `workspaceStore.create`). Putting logic here ensures consistency regardless of the caller.

**Alternatives considered:**
- **App.vue watcher:** Would require orphan detection logic in `BoardView.onWorkspaceChange` separately, and SetupView bypasses it. Fragile.
- **BoardView.onWorkspaceChange only:** Misses workspace switches initiated from SetupView. Tightly couples UI component to store logic.

**Trade-off:** Introduces the first store-to-store dependency from workspace → chat. This is acceptable because:
- Pinia stores are designed for cross-reference (`task.ts` already imports `workspaceStore`)
- Dependency injection pattern keeps it decoupled (no direct function calls, just store methods)
- Initialization order is guaranteed — both stores exist at module level before any method is called

```ts
// workspace.ts
import { useChatStore } from "./chat";  // ← new import

export const useWorkspaceStore = defineStore("workspace", () => {
  const chatStore = useChatStore();     // ← injected at definition time
  
  watch(activeWorkspaceKey, async (key) => {
    if (key) {
      await chatStore.loadSessions(key).catch(console.error);
    }
  });

  return { ... };
});
```

### D2: Close active session on workspace switch

**Chosen:** Call `chatStore.closeSession()` unconditionally when switching workspaces (the existing method already handles clearing `activeChatSessionId`, closing the drawer, and resetting conversation state).

**Why:** A session belonging to another workspace is an "orphan" — it won't appear in the sidebar's filtered list, creating a confusing state where the active session is invisible to the user. Closing it mirrors how boards behave (active board resets on workspace switch).

**Behavior:**
```
User has session 3 open (workspace A)
→ Switches to workspace B
→ closeSession() → drawer closes, activeChatSessionId = null
→ loadSessions(B) → sidebar shows only wsB sessions
→ User must click to re-open any session
```

### D3: No persistence of active session ID across switches

**Chosen:** Each workspace switch triggers a full `loadSessions()` reload. The user re-clicks to select a session. No localStorage persistence of `activeChatSessionId`.

**Why:** Matches the existing board behavior (always reloaded on workspace switch). Keeps state simple — session data is always fresh from the server. Persisting and mapping session IDs to workspaces adds unnecessary complexity with minimal UX benefit.

### D4: Normalize handler code using existing utility

**Chosen:** Update `get`, `getMessages`, and `cancel` handlers to use `fetchChatSessionWithModel(db, sessionId)` instead of raw SQL queries, matching the pattern used by other handlers (`rename`, `archive`, `setModel`).

Extract `resolveWorkspaceKey(params: { workspaceKey?: string }): string` utility from `params.workspaceKey ?? getDefaultWorkspaceKey()`.

**Rationale:** Consistent patterns reduce maintenance burden. The existing `fetchChatSessionWithModel()` does exactly what these handlers need — fetch a session with its model from the conversation join.

## Risks / Trade-offs

| Risk | Mitigation |
|------|-----------|
| `useChatStore()` imported before Pinia creates stores | Stores are defined at module scope; `useChatStore()` returns a composable reference that resolves at runtime, not at import time. Same pattern `task.ts` uses successfully. |
| Store-to-store dependency breaks clean architecture | Already exists in reverse (`task.ts` → `workspaceStore`). This follows the established convention. |
| Orphan detection adds complexity | Decision was simplified: always close on workspace switch, no detection needed. Simplest correct solution. |
| `closeSession()` called even when active session belongs to same workspace | Negligible cost — `closeSession()` is a fast local state reset. Only matters during actual workspace switch. |

## Migration Plan

No migration needed. This is a pure frontend + handler normalization change.

**Deployment steps:**
1. Ship the code — no schema changes, no API contract changes
2. Existing sessions retain their `workspace_key` values unchanged
3. Frontend immediately begins filtering correctly after deployment

**Rollback:** Pure frontend change — revert commit restores previous behavior.

## Open Questions

None remaining. All decisions captured above.
