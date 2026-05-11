---
id: 2026-05-09-remove-workspace-engine-block-tests
title: Test suite design — engine-config breaking change
type: design
status: draft
created: 2026-05-09
companion: 2026-05-09-remove-workspace-engine-block
---

## Layers

### 1. Unit — config loader error paths

Tests use the `makeConfigDir` / `setupTestConfig` helper in an in-memory setup (no live Bun server, no DB IO beyond `:memory:`).

**Pattern**: write files to a temp dir, call `loadConfig()`, assert on `{ error }` or `{ config }`.

**New error-path cases:**
- `EC-ERR-1`: `workspace.yaml` contains `engine:` block → `loadConfig` returns non-null `error` with a migration message
- `EC-ERR-2`: `engines.yaml` is absent → `loadConfig` returns non-null `error`
- `EC-ERR-3`: `engines.yaml` exists but is empty (zero entries) → `loadConfig` returns non-null `error`

**New `defaultModel` resolution cases:**
- `EC-DM-1`: `workspace.yaml` has `default_model: copilot/gpt-4.1` → `config.defaultModel === "copilot/gpt-4.1"`
- `EC-DM-2`: `workspace.yaml` omits `default_model` → `config.defaultModel === null`

**Deleted fallback cases** (no longer valid after the breaking change):
- EC-3 (fallback to `workspace.yaml engine:` when `engines.yaml` absent)
- EC-7 (invalid entries in `engines.yaml` fall back to workspace engine)
- EC-8 (empty `engines.yaml` list falls back to workspace engine)

**Reframed cases:**
- EC-4 (was "engines.yaml wins over workspace.yaml engine:") → becomes `EC-ERR-1` above

### 2. Integration — workspace/task/chat-session handlers

Tests use `makeTestServer()` which spins up a real Bun HTTP server backed by an in-memory SQLite DB. Handler tests call the RPC over HTTP; no mocking of internal modules.

**`setupTestConfig` helper changes** (drives all integration test setup):
- Rename `engineModel` param → `defaultModel` (default: `"copilot/mock-model"`)
- Emit `default_model: <value>` line (omit line entirely when value is `null`)
- Always write a default `engines.yaml` (`[{ id: copilot, type: copilot }]`) unless caller provides one

**Workspace handler tests (`workspace-handlers.test.ts`):**
- `WH-1`: `workspace.getConfig` response includes `defaultModel: "copilot/mock-model"` (was `engine.model`)
- `WH-2`: `workspace.getConfig` response does **not** include an `engine` field
- `WH-3`: `workspace.update` with `defaultModel: "claude/claude-sonnet-4-5"` persists and round-trips
- `WH-4`: Existing test "derives engine type from model prefix" → delete (that branch is removed); replace with a test asserting the raw patch file contains `default_model:` and no `engine:` key

**Task handler tests (`handlers.test.ts`):**
- TC-1 copypasta collapse: 21 identical test bodies → 1 test; assert `conversation.model` is seeded from `config.defaultModel`
- TC-2: when `config.defaultModel` is `null`, `conversation.model` stays `null` (no fallback engine)

**OpenCode config tests (`opencode-config.test.ts`):**
- Full rewrite: move OpenCode engine from `workspace.yaml engine:` block to `engines.yaml`; `workspace.yaml` gets only `default_model: opencode/anthropic/claude-sonnet-4-5`
- Four cases become: valid single-provider, valid no-providers, local LLM provider via `engines.yaml`, multiple providers via `engines.yaml`

**Chat session tests (integration, `handlers.test.ts` or new file):**
- `CS-1`: `chatSessions.sendMessage` seeds `conversation.model` from `config.defaultModel` when session has no model set
- `CS-2`: `chatSessions.sendMessage` with a non-copilot model derives engine for attachment routing from `QualifiedModelId.tryParse(conversationModel)?.engineId`
- `CS-3`: `chatSessions.submitDecisions` same model derivation as CS-2

**Attachment routing unit tests (`attachment-routing.test.ts` or inline):**
- `AR-1`: `prepareMessageForEngine("copilot", ...)` returns content and attachments verbatim (no @file resolution)
- `AR-2`: `prepareMessageForEngine("claude", ...)` resolves `@file:` references in content

### 3. Engine registry — mechanical fixture cleanup

- `engine-registry.test.ts` `makeConfig`: remove `engine: { type: engineIds[0] }` from the mock `LoadedConfig` (field no longer exists on the type); EngineRegistry never reads it so no behavior change
- `multi-engine-execution.test.ts` `makeConfig`: same removal

### 4. Playwright — workspace settings UI

Tests run against the mocked frontend (`e2e/ui/`). `makeWorkspace()` in `mock-data.ts` is the primary data factory.

**`mock-data.ts`:**
- Replace `engine: { model: "copilot/gpt-4.1" }` with `defaultModel: "copilot/gpt-4.1"` in `makeWorkspace()`

**`workspace-settings.spec.ts` new cases (Suite W continuation):**
- `W-6`: Save settings with a `defaultModel` value calls `workspace.update` with `{ defaultModel: "copilot/gpt-4.1" }` (not `engineModel`)
- `W-7`: When `makeWorkspace()` returns `defaultModel: "copilot/gpt-4.1"`, the model dropdown pre-selects "GPT-4.1"
- `W-8`: When `makeWorkspace()` returns `defaultModel: null`, the model dropdown shows no selection

## Dependency injection strategy

- All handler tests use the live Bun server + in-memory DB — no internal module mocking
- Config loader tests use file system temp dirs — no mocking of `fs` or config internals
- `EngineRegistry` is passed a `() => config` getter in tests; the getter returns a handcrafted `LoadedConfig` literal — no engine mock needed for registry tests
- Playwright tests mock all API/WS traffic via `ApiMock` / `WsMock` fixtures; no production server involved

## What NOT to test here

- `enabled_models` DB table — untouched, covered by existing model-list tests
- Engine execution correctness — covered by `multi-engine-execution.test.ts` and API smoke tests
- Worktree / git wiring — unrelated to this change
