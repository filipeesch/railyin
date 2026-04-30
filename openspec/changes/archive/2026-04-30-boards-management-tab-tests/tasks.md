## 1. Test Infrastructure

- [x] 1.1 Extract `goToSetup(page, api)` helper from `e2e/ui/workspace-settings.spec.ts` into new `e2e/ui/fixtures/setup-helpers.ts`
- [x] 1.2 Update `e2e/ui/workspace-settings.spec.ts` to import `goToSetup` from `./fixtures/setup-helpers`
- [x] 1.3 Update `makeBoard()` in `e2e/ui/fixtures/mock-data.ts` to include `taskCount: 0` as a default field

## 2. Backend Handler Tests

- [x] 2.1 Create `src/bun/test/boards.test.ts` with `beforeEach` calling `setupTestConfig()` + `initDb()`, and `afterEach` running `configCleanup()`
- [x] 2.2 DI regression — DR-1: `boardHandlers()` (no args) + `boards.list` works after `initDb()`
- [x] 2.3 Create regression — BC-1: `boards.create` returns board with `taskCount: 0`; BC-2: invalid templateId falls back to first workflow without throwing
- [x] 2.4 `boards.list` taskCount — BL-1/BL-2/BL-3: fresh board has count 0; board with 2 tasks has count 2; per-board isolation
- [x] 2.5 `boards.update` field isolation — BU-1: name-only (others unchanged); BU-2: templateId-only (name unchanged); BU-3: projectKeys round-trip; BU-4: empty projectKeys valid
- [x] 2.6 `boards.update` validation — BU-5: invalid templateId throws + board not mutated; BU-6: non-existent id throws
- [x] 2.7 `boards.delete` — BD-1: empty board deleted; BD-2: 1 task throws with "1" in message; BD-3: 3 tasks throws with "3" in message; BD-4: board row survives failed delete

## 3. Board Store Tests

- [x] 3.1 Create `src/mainview/stores/board.test.ts` with `vi.mock("../rpc")` + `setActivePinia(createPinia())` in `beforeEach`
- [x] 3.2 `updateBoard` — SU-1: calls `boards.update` with correct params; SU-2: calls `boards.list` after success; SU-3: propagates API error
- [x] 3.3 `deleteBoard` — SD-1: calls `boards.delete` with correct id; SD-2: removes board from `boards.value`; SD-3: switches `activeBoardId` when deleting active board; SD-4: sets `activeBoardId` to null when last board deleted; SD-5: boards.value unchanged on API error

## 4. Playwright UI Tests

- [x] 4.1 Create `e2e/ui/board-setup.spec.ts` — import `goToSetup` from `./fixtures/setup-helpers`, `makeBoard` + `makeProject` + `makeWorkspace` + `makeWorkflowTemplate` from `./fixtures/mock-data`
- [x] 4.2 Suite B (list rendering) — B-1: names + template names visible; B-2: empty list shows Add board button only
- [x] 4.3 Suite BA (add dialog) — BA-1: dialog opens; BA-2: Create disabled when name empty; BA-4: `boards.create` called with name + templateId; BA-5: project checkboxes populate projectKeys; BA-6: dialog closes on success
- [x] 4.4 Suite BE (edit dialog) — BE-1: pre-filled with name; BE-3: rename calls `boards.update`; BE-4: project change calls `boards.update` with updated projectKeys
- [x] 4.5 Suite BW (workflow warning) — BW-1: no warning when taskCount=0; BW-2: warning visible when taskCount>0 and workflow changed; BW-3: Save button not disabled when warning visible
- [x] 4.6 Suite BD (delete) — BD-1: toast shown for board with tasks (no dialog); BD-2: confirm dialog shown for empty board; BD-4: confirm calls `boards.delete`; BD-5: board disappears from list; BD-6: cancel → no API call
- [x] 4.7 Suite BER (error handling) — BER-1: `boards.create` error shown in dialog; BER-3: `boards.delete` error shown in confirm dialog

## 5. Verification

- [x] 5.1 Run `bun test src/bun/test/boards.test.ts --timeout 20000` — all tests pass
- [x] 5.2 Run `bun test src/mainview/stores/board.test.ts` — all tests pass
- [x] 5.3 Run `bun run build && npx playwright test e2e/ui/board-setup.spec.ts` — all tests pass
- [x] 5.4 Run `bun run build && npx playwright test e2e/ui/workspace-settings.spec.ts` — no regressions from goToSetup extraction
