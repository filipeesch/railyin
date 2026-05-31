## Context

PR #63 (`fix: chat sessions not persisting correctly`) introduced `useSessionSyncHandler`, a composable that handles chat session list synchronization on workspace switch and WebSocket reconnect. Chat sessions now reload correctly when switching workspaces, verified by E2E tests WS-NAV-4/5.

However, **board lists are NOT reloaded on workspace switch**. The flow:

```
User clicks workspace tab
    │
    ▼
BoardView.onWorkspaceChange(wsKey)
    ├── workspaceStore.selectWorkspace(key)
    │      ├─► activeWorkspaceKey = key   (localStorage ✅)
    │      └─► load() → getConfig()       (config ✅)
    │
    ├── useSessionSyncHandler(watchKey=activeWorkspaceKey)
    │      └─► watch fires → loadSessions(key)  ✅ SESSIONS FIXED
    │
    └── boardStore.selectFirstBoardInWorkspace(wsKey)
           └─► picks from PRE-CACHED boards array  ❌ STALE DATA
```

`boards.list` is called only once at app mount in `App.vue`. Boards have a `workspaceKey` field and are filtered client-side by `findFirstBoardInWorkspace()`. If a new board is created in any workspace after app start, the cached array won't include it. Switching to that workspace selects from stale data.

## Goals / Non-Goals

**Goals:**
- Reload board list whenever the active workspace changes.
- Use the same composable pattern established by `useSessionSyncHandler` for consistency.
- Remove redundant `selectFirstBoardInWorkspace()` call from `BoardView.onWorkspaceChange`.
- No breaking changes to existing API contracts or store interfaces.

**Non-Goals:**
- Changing `boards.list` to accept workspace filtering on the backend (client-side filter is sufficient).
- Adding real-time board push events via WebSocket.
- Implementing debounce/ordering guarantees (concurrent calls produce correct final state due to Pinia ref replacement semantics).
- Writing tests (handled in separate test suite change).

## Decisions

### Decision 1: Mirror `useSessionSyncHandler` with a `useBoardSyncHandler`
**Choice:** Create a second composable following the exact same pattern as `useSessionSyncHandler`, but calling `boardStore.loadBoards()` instead of `chatStore.loadSessions()`.

```typescript
// useBoardSyncHandler.ts
export interface BoardSyncDeps {
  loadBoards: (key?: string) => void;
  watchKey: () => string | null;
}

export function useBoardSyncHandler(deps: BoardSyncDeps): void {
  watch(
    () => deps.watchKey(),
    (key) => {
      deps.loadBoards(key ?? undefined);
    },
    { immediate: true },
  );
}
```

**Rationale:**
- Same pattern reduces cognitive overhead — developers see two identical composables, one for sessions, one for boards.
- Keeps stores independent: each composable imports only the store it needs.
- No cross-store coupling in `workspaceStore` (avoids Decision 1 from original proposal which was superseded by PR #63's approach).

**Alternatives considered:**
- *Single coordinator composable*: Would accept multiple reload callbacks and orchestrate them. More powerful but more complex; unnecessary for just two reloads.
- *Add board reload inside `selectWorkspace()`*: Reverts to the rejected pre-#63 approach. Composables provide better separation of concerns and easier testing.
- *Modify `selectFirstBoardInWorkspace()` to call `loadBoards()`*: Would couple board selection logic with data fetching — violates SRP.

### Decision 2: Do NOT add ordering guarantees between session and board reloads
**Choice:** Let both composables run concurrently. No coordination needed because:
- Sessions and boards are independent UI concerns (sidebar vs main board area).
- Pinia's `ref.value = newArray` semantics ensure atomic replacement regardless of arrival order.
- Both endpoints return complete datasets; partial data never renders.

```
Timeline during workspace switch:
─────────────────────────────────────────────
t0: activeWorkspaceKey = "ws-b" (watch triggers)
t1: [concurrent] loadSessions("ws-b") starts
t2: [concurrent] loadBoards("ws-b") starts
t3: loadSessions returns → chatStore.sessions replaced
t4: loadBoards returns → boardStore.boards replaced + auto-select
t5: UI shows ws-b sessions AND ws-b boards
─────────────────────────────────────────────
Order between t3/t4 doesn't matter — user sees either:
  - Both old data briefly, then both new data (fast network)
  - Sessions new + boards old briefly, then both new (slow boards API)
Both states are valid and self-correcting.
```

**Risk mitigation:** If a specific ordering becomes important later (e.g., selecting a board requires session model info), introduce a coordinator at that point. Don't over-engineer now.

### Decision 3: Simplify BoardView caller
**Choice:** Remove `boardStore.selectFirstBoardInWorkspace(workspaceKey)` from `onWorkspaceChange`. The `loadBoards()` action already contains logic to automatically select a board when `activeBoardId` doesn't belong to the target workspace (lines ~24-31 in board.ts).

```typescript
// Before
async function onWorkspaceChange(workspaceKey: string) {
  await workspaceStore.selectWorkspace(workspaceKey);
  boardStore.selectFirstBoardInWorkspace(workspaceKey);  // REMOVED
}

// After
async function onWorkspaceChange(workspaceKey: string) {
  await workspaceStore.selectWorkspace(workspaceKey);
  // loadBoards() inside useBoardSyncHandler handles board selection
}
```

**Rationale:** Eliminates duplicate logic. `loadBoards()` already has auto-selection built-in via its persisted `activeBoardId` check.

## Risks / Trade-offs

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Duplicate `boards.list` API calls per workspace switch | High (expected) | One extra HTTP request per switch. Boards rarely change (<1/min). Acceptable trade-off for correctness. Can add debouncing if metrics show excessive calls. |
| Rapid consecutive switches cause overlapping requests | Medium | Pinia ref assignment is atomic. Final state always reflects last response. No data corruption risk. |
| New composable could be forgotten when adding other workspace-scope reloads (e.g., project config) | Low | Document pattern in `src/mainview/composables/README.md` or inline comment. Future additions can follow the same template. |
| Board sync runs even during setup navigation before route reaches /board | Very low | `useBoardSyncHandler` would call `loadBoards()` which is idempotent and safe to call early. No side effects beyond fetching data. |

## Migration Plan

This is a pure code change with no data migration or API contract changes. Deploy as a regular commit.

1. Create `useBoardSyncHandler.ts` composable (mirrors `useSessionSyncHandler`).
2. Register it in `App.vue` alongside existing `useSessionSyncHandler`.
3. Remove manual `selectFirstBoardInWorkspace()` call from `BoardView.onWorkspaceChange`.
4. Run existing tests: `bun test src/bun` (backend), `bun test src/mainview/stores/*` (frontend unit tests), `bun run test:e2e:board` (Playwright).
5. Manual verification: create board in workspace A while viewing workspace B, switch to A, confirm new board appears.

No rollback-specific steps needed — reverting the changed files restores old behavior.

## Open Questions

None. All decisions captured above. The bug root cause (boards not reloading on switch) is confirmed and isolated.
