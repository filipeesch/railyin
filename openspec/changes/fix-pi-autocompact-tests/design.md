## Context

The `fix-pi-autocompact` change modifies `PiEngine`'s constructor (new params), removes context window defaults, changes how `compact()` resolves model and contextWindow, and filters `models.listEnabled` server-side. These are behavioural changes without existing test coverage. This document describes the testing strategy: what infrastructure needs adapting, what new test doubles are required, and the test-by-test design for each new case.

## Goals / Non-Goals

**Goals:**
- Fix all compilation failures in existing Pi test files caused by the constructor change
- Cover the RC1 fix (`buildCompactionSettings` returns correct in-memory settings)
- Cover `compact()` model/contextWindow resolution paths (found and not found)
- Cover `models.listEnabled` null-contextWindow filtering (Pi-specific and non-Pi)
- Cover the warning badge UI in the model setup page
- Cover the compact button guard (hidden when model unconfigured or task.model null)

**Non-Goals:**
- Testing `SettingsManager.inMemory` SDK internals (SDK responsibility)
- End-to-end compaction flow (session prompt → auto-compact → retry) — complex to mock at SDK level, deferred
- Performance or load testing

## Decisions

### D1: `MockModelSettingsRepository` — simple stub object, not a class

For unit tests, the `ModelSettingsRepository` dependency is satisfied by a plain stub object implementing only `getContextWindow(workspaceKey, qualifiedModelId): Promise<number | null>`. No class needed — TypeScript structural typing allows `{ getContextWindow: vi.fn() }`. This is consistent with how `getDb()` calls are mocked throughout the existing Pi tests.

### D2: `protected buildCompactionSettings()` override in `TestPiEngine`

PE-SETTINGS-1 needs to verify the protected method returns the correct shape. `TestPiEngine` (the existing test subclass) extends `PiEngine` and exposes it as a public method `exposeCompactionSettings()` calling `super.buildCompactionSettings()`. No additional production code change — `buildCompactionSettings` is already `protected` per the implementation task in `fix-pi-autocompact`.

### D3: In-memory SQLite for `models.listEnabled` integration tests

The existing `model-handlers.test.ts` pattern uses an in-memory `betterSqlite3` DB seeded per test. New tests follow the same pattern: seed `model_settings` with specific `context_window` values (including null), call the handler, assert the returned models. No change to the pattern.

### D4: Playwright mock fixtures for warning badge and compact button tests

Playwright tests use `mock-api.ts` for RPC intercept. The warning badge tests extend the existing `MODELS_NO_CTX` fixture (already present in `model-context-window.spec.ts`). The compact button tests extend the existing chat mock to inject a task with `model: null` or `model: "pi/lmstudio/qwen3:8b"` while removing that model from the `listEnabled` response — verifying the button state without a real Bun server.

### D5: Compact button test file placement

Compact button blocking tests live in a **new** `e2e/ui/compact-button.spec.ts` file rather than in `chat.spec.ts`. The scenarios are logically about compaction, not general chat. `model-context-window.spec.ts` keeps the warning badge tests since they're visually co-located with the context window editor.
