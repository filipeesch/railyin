## 1. Unit Tests — readStorage Utility

- [ ] 1.1 Create `src/mainview/utils/storage.test.ts` with `RS-1` — valid JSON key returns parsed value
- [ ] 1.2 Add `RS-2` — missing key returns fallback
- [ ] 1.3 Add `RS-3` — malformed JSON returns fallback without throwing
- [ ] 1.4 Add `RS-4` — undefined localStorage guard returns fallback (use `vi.stubGlobal` to remove localStorage)

## 2. Unit Tests — Workspace Store Persistence

- [ ] 2.1 Create `src/mainview/stores/workspace.test.ts` with `beforeEach` calling `setActivePinia(createPinia())` and `localStorage.clear()`
- [ ] 2.2 Add `WS-P-1` — no stored key, `activeWorkspaceKey` starts null
- [ ] 2.3 Add `WS-P-2` — stored key matches workspace list, restored after `loadWorkspaces()`
- [ ] 2.4 Add `WS-P-3` — stored key absent from list, falls back to first workspace
- [ ] 2.5 Add `WS-P-4` — `selectWorkspace()` call persists key to localStorage (await nextTick before asserting)

## 3. Unit Tests — Board Store Persistence

- [ ] 3.1 Add `localStorage.clear()` to the top-level `beforeEach` in `src/mainview/stores/board.test.ts`
- [ ] 3.2 Add new `describe("BP — board persistence", ...)` suite in `board.test.ts`
- [ ] 3.3 Add `BP-1` — no stored id, `activeBoardId` falls back to first board
- [ ] 3.4 Add `BP-2` — stored id in board list, restored after `loadBoards()`
- [ ] 3.5 Add `BP-3` — stored id not in list, falls back to first board
- [ ] 3.6 Add `BP-4` — stored id belongs to wrong workspace, `loadBoards("ws-b")` falls back to first board of `"ws-b"`
- [ ] 3.7 Add `BP-5` — `selectBoard()` persists id to localStorage (await nextTick)
- [ ] 3.8 Add `BP-6` — stored id + correct workspace, id is preserved

## 4. E2E Tests — Selection Persistence

- [ ] 4.1 Create `e2e/ui/board-selection-persistence.spec.ts` with `BP-E2E-1` — `page.addInitScript` seeds both keys; after `page.goto("/")` workspace tab `"ws-2"` is active and correct board shown
- [ ] 4.2 Add `BP-E2E-2` — empty localStorage, defaults to first workspace and board
- [ ] 4.3 Add `BP-E2E-3` — click workspace tab, `page.evaluate` reads persisted key
- [ ] 4.4 Add `BP-E2E-4` — select board from dropdown, `page.evaluate` reads persisted id
- [ ] 4.5 Add `BP-E2E-5` — stale workspace key, page falls back to first workspace
- [ ] 4.6 Add `BP-E2E-6` — stale board id, page falls back to first board of active workspace
- [ ] 4.7 Extend `e2e/ui/board-workspace-nav.spec.ts` with `WS-NAV-3` — tab click persists key to localStorage

## 5. E2E Tests — Board Header Workflow Edit

- [ ] 5.1 Create `e2e/ui/board-header-workflow-edit.spec.ts` with `BWE-1` — pencil button visible when board is active
- [ ] 5.2 Add `BWE-2` — no board, pencil button not rendered (empty boards list)
- [ ] 5.3 Add `BWE-3` — click pencil, `api.returns("workflow.getYaml", { yaml })`, verify overlay visible with YAML content
- [ ] 5.4 Add `BWE-4` — save in overlay, `api.capture("workflow.saveYaml", { ok: true })`, verify overlay closes
- [ ] 5.5 Add `BWE-5` — save in overlay, capture `boards.list` calls, verify re-called after save
