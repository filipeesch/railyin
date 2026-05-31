## 1. Database

- [x] 1.1 Create migration `047_conversation_sampling_preset.sql`: `ALTER TABLE conversations ADD COLUMN sampling_preset_override TEXT NULL`
- [x] 1.2 Add `sampling_preset_override: string | null` to `ConversationRow` in `src/bun/db/row-types.ts`

## 2. Shared Types

- [x] 2.1 Add `samplingPresetOverride: string | null` to `Task` in `src/shared/rpc-types.ts`
- [x] 2.2 Add `samplingPresetOverride: string | null` to `ChatSession` in `src/shared/rpc-types.ts`
- [x] 2.3 Add `availablePresets?: Array<{ name: string; params: SamplingPreset }>` to `ModelInfo` in `src/shared/rpc-types.ts`
- [x] 2.4 Add `conversations.setSamplingPreset` RPC method entry (`{ conversationId: number; preset: string | null } → void`) to `src/shared/rpc-types.ts`

## 3. Backend — conversations handler

- [x] 3.1 Implement `conversations.setSamplingPreset` handler: write `sampling_preset_override` to DB
- [x] 3.2 Update `tasks` query (list/get) to include `conversations.sampling_preset_override` → `samplingPresetOverride` in response
- [x] 3.3 Update `chatSessions.list` query to include `conversations.sampling_preset_override` → `samplingPresetOverride` in response

## 4. Backend — models handler

- [x] 4.1 In `models.listEnabled` handler, populate `availablePresets` from `PiEngineConfig.sampling_presets` for Pi engine models

## 5. ExecutionParamsEnricher

- [x] 5.1 Create `src/bun/engine/execution/execution-params-enricher.ts` with `ExecutionParamsEnricher` class
- [x] 5.2 Implement `enrich(base, ctx)`: load `conversations.sampling_preset_override`, apply resolution chain for `samplingPresetName`; load `ModelSettingsRepository` for `contextWindowOverride`; return new params object
- [x] 5.3 Register `ExecutionParamsEnricher` in the DI container / wiring layer

## 6. Executor refactor

- [x] 6.1 Inject `ExecutionParamsEnricher` into `TransitionExecutor`; replace inline spread of `contextWindowOverride`/`samplingPresetName` with `enricher.enrich()`
- [x] 6.2 Inject `ExecutionParamsEnricher` into `HumanTurnExecutor`; remove inline spread and call `enricher.enrich()` with `columnPreset`
- [x] 6.3 Inject `ExecutionParamsEnricher` into `RetryExecutor`; remove inline spread and call `enricher.enrich()` with `columnPreset`
- [x] 6.4 Inject `ExecutionParamsEnricher` into `ChatExecutor`; call `enricher.enrich()` with `columnPreset` (if applicable)

## 7. Frontend — ConversationInput

- [x] 7.1 Add `samplingPresetOverride: string | null` and `availablePresets: ModelInfo['availablePresets']` props to `ConversationInput.vue`
- [x] 7.2 Add `update:samplingPresetOverride` emit to `ConversationInput.vue`
- [x] 7.3 Render a PrimeVue `Select` in the model row, conditional on `engineId === 'pi'` and `availablePresets?.length > 0`
- [x] 7.4 Include an "Auto" option (value `null`) as first item with subtext "(column default)"
- [x] 7.5 Style the open option rows to show preset name + parameter detail line (`temp=X  top_p=X` etc.)

## 8. Frontend — parent views

- [x] 8.1 Pass `samplingPresetOverride` and `availablePresets` props from `TaskChatView.vue` to `ConversationInput`
- [x] 8.2 Handle `update:samplingPresetOverride` in `TaskChatView.vue`: call `conversations.setSamplingPreset` and update local task state
- [x] 8.3 Pass `samplingPresetOverride` and `availablePresets` props from `SessionChatView.vue` to `ConversationInput`
- [x] 8.4 Handle `update:samplingPresetOverride` in `SessionChatView.vue`: call `conversations.setSamplingPreset` and update local session state
