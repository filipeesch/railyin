## 1. Create `useBoardSyncHandler` composable

- [ ] 1.1 Create `src/mainview/composables/useBoardSyncHandler.ts` mirroring `useSessionSyncHandler` pattern
- [ ] 1.2 Define `BoardSyncDeps` interface: `loadBoards(key?)`, `watchKey() → string | null`
- [ ] 1.3 Implement watch with `{ immediate: true }` that calls `deps.loadBoards(key)` on key changes
- [ ] 1.4 Verify file follows same import/style conventions as `useSessionSyncHandler.ts`

## 2. Wire board sync in `App.vue`

- [ ] 2.1 Import `useBoardSyncHandler` from composables
- [ ] 2.2 Add call alongside existing `useSessionSyncHandler`: pass `boardStore.loadBoards.bind(boardStore)` and `() => workspaceStore.activeWorkspaceKey`
- [ ] 2.3 Verify both composables are registered before router push (they use Vue reactivity, not await)

## 3. Simplify BoardView caller

- [ ] 3.1 In `onWorkspaceChange()`, remove `boardStore.selectFirstBoardInWorkspace(workspaceKey)` line
- [ ] 3.2 Keep `await workspaceStore.selectWorkspace(workspaceKey)` — it triggers both session AND board sync via composables
- [ ] 3.3 Verify no other callers in BoardView depend on explicit `selectFirstBoardInWorkspace` after switch

## 4. Validation

- [ ] 4.1 Run unit tests: `bun test src/mainview/stores/*` — all existing tests should pass unchanged
- [ ] 4.2 Run E2E tests: `bun run test:e2e:board` — workspace nav tests should still pass
- [ ] 4.3 Manual smoke test: create board in WS-A while viewing WS-B, switch to A, confirm new board visible
- [ ] 4.4 Manual smoke test: rapid switching (A→B→C) converges to correct final state
