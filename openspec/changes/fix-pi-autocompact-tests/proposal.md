## Why

The `fix-pi-autocompact` change introduces breaking constructor changes to `PiEngine`, removes fallback defaults, adds DB lookups in `compact()`, and changes server-side model filtering. None of these paths have test coverage for the new behaviour — without a dedicated test suite, regressions in the compaction fix will be invisible.

## What Changes

- **Adapt existing Pi engine tests** for the new `ModelSettingsRepository` + `workspaceKey` constructor params (two existing test files break on compile; they need a mock repo injected)
- **New unit tests — `buildCompactionSettings()`**: Verify the protected method returns the correct in-memory settings that fix RC1
- **New unit tests — `compact()` model resolution**: Verify `compact()` reads the correct model and contextWindow from DB, and blocks (throws) when either is unresolvable
- **New integration tests — `models.listEnabled` filter**: Verify that Pi models with `contextWindow: null` are excluded, DB overrides are applied, and non-Pi models are unaffected
- **New Playwright tests — warning badge**: Verify the ⚠ badge appears on unconfigured Pi models in the model setup page, with correct tooltip and click-to-edit behaviour
- **New Playwright tests — compact button blocking**: Verify the Compact button is hidden when the conversation model is absent from `availableModels` (null-contextWindow filtered out) and when `task.model` is null

## Capabilities

### New Capabilities

- `pi-autocompact-test-coverage`: Full unit, integration, and Playwright test suite covering all new behaviour introduced by `fix-pi-autocompact` — constructor injection, compaction settings isolation, model/contextWindow resolution in compact(), listEnabled filtering, warning badge UI, and compact button guard

### Modified Capabilities

- `pi-compaction-unit-tests`: Extend with constructor-change adaptation scenarios and new compact() model-resolution test cases (PE-COMPACT-5 through PE-COMPACT-8, PE-SETTINGS-1)

## Impact

- `src/bun/test/pi-engine.test.ts` — constructor adaptation + new compact() test block
- `src/bun/test/pi-engine-models.test.ts` — constructor adaptation (makeEngine mock args)
- `src/bun/test/model-handlers.test.ts` — new `listEnabled` filter scenarios
- `e2e/ui/model-context-window.spec.ts` — new warning badge Playwright scenarios
- `e2e/ui/chat.spec.ts` (or new `e2e/ui/compact-button.spec.ts`) — compact button blocking Playwright scenarios
- No production code changes — if refactoring is required to enable testing (e.g. `protected buildCompactionSettings()`), it is included in `fix-pi-autocompact` implementation tasks, not here
