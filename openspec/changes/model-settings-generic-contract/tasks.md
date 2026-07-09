## 1. DB Migration

- [x] 1.1 Create migration `051_conversation_model_params.ts`: add `model_params JSON NULL`, migrate existing `reasoning_mode_override` rows to `[{"id":"effort","value":"<value>"}]` JSON, drop `reasoning_mode_override` column
- [x] 1.2 Update `src/bun/db/row-types.ts`: replace `reasoning_mode_override: string | null` with `model_params: string | null` on `ConversationRow` and `TaskRow` / `ChatSessionRow`
- [x] 1.3 Update `src/bun/db/mappers.ts`: replace `reasoningModeOverride` mapping with `modelParams` (parse JSON → `ModelParamValue[]`)
- [x] 1.4 Update all SQL queries in `task-queries.ts`, `chat-sessions.ts`, `tasks.ts`, `conversations.ts`, `reasoning-mode-policy.ts` that reference `reasoning_mode_override`

## 2. Shared Types

- [x] 2.1 Add `ModelParamValue { id: string; value: string }` and `ModelSettingAxis { id: string; label: string; options: Array<{value: string; label: string}>; defaultValue: string | null; visible: boolean }` to `src/shared/rpc-types.ts`
- [x] 2.2 Replace `ModelSettingsInfo.reasoningMode` with `ModelSettingsInfo.settings: ModelSettingAxis[]`
- [x] 2.3 Replace `Task.reasoningModeOverride: string | null` with `Task.modelParams: ModelParamValue[]`
- [x] 2.4 Replace `ChatSession.reasoningModeOverride: string | null` with `ChatSession.modelParams: ModelParamValue[]`

## 3. Engine Layer — EngineModelInfo & ExecutionParams

- [x] 3.1 Update `src/bun/engine/types.ts`: replace `supportedReasoningModes`, `defaultReasoningMode`, `rawReasoningModeMetadata` on `EngineModelInfo` with `settings: ModelSettingAxis[]`
- [x] 3.2 Add `modelParams?: ModelParamValue[]` to `ExecutionParams` in `src/bun/engine/types.ts`
- [x] 3.3 Update `ExecutionParamsEnricher`: read `model_params` from DB, deserialize JSON, inject as `params.modelParams`

## 4. Model Settings Normalizer

- [x] 4.1 Refactor `src/bun/models/model-settings-normalizer.ts`: map `EngineModelInfo.settings[]` → `ModelSettingsInfo.settings[]` (pass-through, since engines now own synthesis)
- [x] 4.2 Remove Cursor-specific inference logic (`isCursorReasoningSemantic`, variant regex filters) from normalizer

## 5. Engine Adapters — listModels() Synthesis

- [x] 5.1 Update `src/bun/engine/claude/engine.ts` `listModels()`: synthesize `settings: [{ id: "effort", label: "Effort", options: [...], defaultValue: null, visible: true }]` from `supportedEffortLevels[]`; return `[]` when `supportsEffort` is false
- [x] 5.2 Update `src/bun/engine/copilot/engine.ts` `listModels()`: synthesize `settings: [{ id: "reasoningEffort", label: "Reasoning Effort", options: [...], defaultValue: defaultReasoningEffort, visible: true }]` from `supportedReasoningEfforts[]`; return `[]` when not supported
- [x] 5.3 Update `src/bun/engine/cursor/engine.ts` `listModels()`: map `parameters[]` → `settings[]` (one axis per parameter); if no `parameters[]`, map `variants[]` → single axis `id:"variant"` with variant displayNames as options, default from `isDefault: true` variant; return `[]` when neither present

## 6. Engine Adapters — execute() Runtime Wiring

- [x] 6.1 Update `src/bun/engine/claude/adapter.ts` `run()`: extract `modelParams.find(p => p.id === "effort")?.value` and pass as `effort` in `ClaudeRunConfig`; forward to SDK call
- [x] 6.2 Update `src/bun/engine/copilot/engine.ts` `execute()`: extract `modelParams.find(p => p.id === "reasoningEffort")?.value` and pass as `reasoningEffort` in `SessionConfig`
- [x] 6.3 Update `src/bun/engine/cursor/worker.mjs` + engine wiring: accept `modelParams[]` in the model selection object; pass as `ModelSelection.params` to `Agent.create/resume`; handle variant-mode axis (look up `variantParams` by value to resolve to actual `params[]`)

## 7. Model Params Policy

- [x] 7.1 Rename `src/bun/conversation/reasoning-mode-policy.ts` → `model-params-policy.ts`; update logic to operate on `settings[]` + `model_params` JSON array: retain compatible `{id, value}` pairs, clear incompatible ones, apply defaults for unset axes

## 8. Handlers & RPC

- [x] 8.1 Update `src/bun/handlers/conversations.ts`: rename `setReasoningMode` → `setModelParams`; store/retrieve `model_params` as JSON
- [x] 8.2 Update `src/bun/handlers/tasks.ts`: include `modelParams` (parsed from `model_params` JSON) in task RPC response; call `model-params-policy` on model switch
- [x] 8.3 Update `src/bun/handlers/chat-sessions.ts`: include `modelParams` in session RPC response; call `model-params-policy` on model switch
- [x] 8.4 Update `src/shared/rpc-types.ts` RPC method signatures: `conversations.setModelParams` replaces `conversations.setReasoningMode`

## 9. Frontend

- [x] 9.1 Update `src/mainview/stores/tasks.ts`: replace `reasoningModeOverride` with `modelParams: ModelParamValue[]`; handle `task.updated` push event
- [x] 9.2 Update `src/mainview/stores/chat.ts` (chat sessions store): replace `reasoningModeOverride` with `modelParams: ModelParamValue[]`
- [x] 9.3 Rename/refactor `ConversationInput` reasoning selector: replace hard-coded `reasoningMode` select with a generic `ModelSettingsSelector` component that renders one selector per `settings[]` axis; bind to `modelParams`; call `rpc.conversations.setModelParams` on change
- [x] 9.4 Update model-switch handler in the frontend: when model changes, reset `modelParams` to empty and let the backend policy apply new defaults via the next `task.updated` push

## 10. Test Updates

- [x] 10.1 Update backend unit tests: any test referencing `reasoning_mode_override`, `reasoningModeOverride`, `supportedReasoningModes`, or `defaultReasoningMode` — update to new field names and shapes
- [x] 10.2 Update frontend store tests: replace `reasoningModeOverride` assertions with `modelParams`
- [x] 10.3 Update Playwright WS mock fixtures: push events must carry `modelParams` instead of `reasoningModeOverride`
- [x] 10.4 Add unit tests for `model-params-policy.ts`: compatibility check, default application, JSON round-trip
- [x] 10.5 Add unit tests for each engine's `listModels()` synthesis: verify correct `ModelSettingAxis` shape produced from mock SDK responses
