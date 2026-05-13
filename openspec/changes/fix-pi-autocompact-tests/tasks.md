## 1. Adapt Existing Tests for Constructor Change

- [ ] 1.1 Update `TestPiEngine` in `src/bun/test/pi-engine.test.ts`:
  - Add `MockModelSettingsRepository` stub (`{ getContextWindow: vi.fn() }`) as new constructor param
  - Forward mock repo + a `"test-workspace"` workspaceKey to `super()`
  - Expose `exposeCompactionSettings()` calling `super.buildCompactionSettings()`
- [ ] 1.2 Update `makeEngine()` in `src/bun/test/pi-engine-models.test.ts`:
  - Add the same `MockModelSettingsRepository` stub and `"test-workspace"` string as constructor args
- [ ] 1.3 Run `bun test src/bun/test/pi-engine.test.ts --timeout 20000` and `bun test src/bun/test/pi-engine-models.test.ts --timeout 20000` to confirm both compile and all existing tests pass

## 2. New Unit Tests — buildCompactionSettings (RC1 fix verification)

- [ ] 2.1 Add `describe("PiEngine.buildCompactionSettings()")` block to `pi-engine.test.ts`
- [ ] 2.2 Add PE-SETTINGS-1: `exposeCompactionSettings()` returns `{ enabled: true, reserveTokens: 16384, keepRecentTokens: 20000 }`

## 3. New Unit Tests — compact() Model Resolution

- [ ] 3.1 Add `describe("PiEngine.compact() — model resolution")` block to `pi-engine.test.ts`
- [ ] 3.2 Add PE-COMPACT-5: `compact()` with `conversations.model = "pi-local/lmstudio/llama-3.2-3b"` → session created with stripped model id `"lmstudio/llama-3.2-3b"`
- [ ] 3.3 Add PE-COMPACT-6: `mockModelSettingsRepo.getContextWindow` returns `32768` → session has `contextWindow = 32768`
- [ ] 3.4 Add PE-COMPACT-7: `mockModelSettingsRepo.getContextWindow` returns `null` → `compact()` rejects with error about missing context window
- [ ] 3.5 Add PE-COMPACT-8: `conversations.model` is `NULL` in DB → `compact()` rejects with error about missing model
- [ ] 3.6 Run full `pi-engine.test.ts` to confirm all scenarios pass

## 4. New Integration Tests — models.listEnabled Filter

- [ ] 4.1 Locate the `models.listEnabled` describe block in `src/bun/test/model-handlers.test.ts`
- [ ] 4.2 Add MH-L-1: Pi model with `contextWindow: null` → absent from `listEnabled` response
- [ ] 4.3 Add MH-L-2: Pi model with null engine ctx + DB override `32768` → present in `listEnabled` with `contextWindow: 32768`
- [ ] 4.4 Add MH-L-3: Pi model with engine ctx `131072` + DB override `65536` → present in `listEnabled` with `contextWindow: 65536`
- [ ] 4.5 Add MH-L-4: Copilot model with `contextWindow: 131072` → present in `listEnabled` regardless of `model_settings`
- [ ] 4.6 Run `bun test src/bun/test/model-handlers.test.ts --timeout 20000` to confirm all scenarios pass

## 5. New Playwright Tests — Warning Badge in Model Setup Page

- [ ] 5.1 Add to `e2e/ui/model-context-window.spec.ts` using the existing `MODELS_NO_CTX` mock fixture
- [ ] 5.2 Add CTX-W-1: Pi model with `contextWindow: null` → `.model-ctx-warning` badge is visible
- [ ] 5.3 Add CTX-W-2: Hover over badge → tooltip text contains "chat picker" (or equivalent copy)
- [ ] 5.4 Add CTX-W-3: Pi model with `contextWindow: 32768` → no `.model-ctx-warning` badge visible
- [ ] 5.5 Add CTX-W-4: Click warning badge → context window input field becomes focused
- [ ] 5.6 Add CTX-W-5: Copilot model with `contextWindow: null` and `contextWindowEditable: false` → no warning badge
- [ ] 5.7 Run `bun run build && npx playwright test e2e/ui/model-context-window.spec.ts` to confirm all pass

## 6. New Playwright Tests — Compact Button Guard

- [ ] 6.1 Create `e2e/ui/compact-button.spec.ts` with mock fixtures extending existing `mock-api.ts` patterns
- [ ] 6.2 Add MP-F-1: Task with `model: "pi-local/lmstudio/qwen3:8b"`, listEnabled does NOT include that model → Compact action NOT visible
- [ ] 6.3 Add MP-F-2: Task with `model: "pi-local/lmstudio/qwen3:8b"`, listEnabled INCLUDES that model with `supportsManualCompact: true` → Compact action IS visible
- [ ] 6.4 Add MP-F-3: Task with `model: null`, `availableModels[0]` is a Pi model with `supportsManualCompact: true` → Compact action NOT visible
- [ ] 6.5 Run `bun run build && npx playwright test e2e/ui/compact-button.spec.ts` to confirm all pass
