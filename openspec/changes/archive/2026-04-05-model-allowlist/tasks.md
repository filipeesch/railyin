## 1. DB Migration

- [x] 1.1 Add a new migration in `src/bun/db/migrations.ts` that creates `enabled_models (workspace_id INTEGER NOT NULL, qualified_model_id TEXT NOT NULL, PRIMARY KEY (workspace_id, qualified_model_id))`

## 2. Shared Types

- [x] 2.1 Add `ProviderModelList` interface to `src/shared/rpc-types.ts`: `{ id: string; models: Array<{ id: string; contextWindow: number | null; enabled: boolean }>; error?: string }`
- [x] 2.2 Update `models.list` RPC response type in `src/shared/rpc-types.ts` from `ModelInfo[]` to `ProviderModelList[]`
- [x] 2.3 Add `models.setEnabled` RPC entry to `src/shared/rpc-types.ts`: request `{ qualifiedModelId: string; enabled: boolean }`, response `{}`
- [x] 2.4 Add `models.listEnabled` RPC entry to `src/shared/rpc-types.ts`: request `{}`, response `ModelInfo[]`

## 3. Backend: models.list Rewrite

- [x] 3.1 Rewrite the `models.list` handler in `src/bun/handlers/tasks.ts` to return `ProviderModelList[]` — one entry per configured provider, preserving the existing `Promise.allSettled` fan-out but grouping results per provider instead of merging into a flat list
- [x] 3.2 Join each model's `enabled` flag in `models.list` by querying `enabled_models` for the current workspace after the provider fetch completes

## 4. Backend: models.setEnabled Handler

- [x] 4.1 Add `models.setEnabled` handler in `src/bun/handlers/tasks.ts`: when `enabled: true`, upsert `(workspace_id, qualifiedModelId)` into `enabled_models`; when `false`, delete the matching row (no-op if absent)

## 5. Backend: models.listEnabled Handler

- [x] 5.1 Add `models.listEnabled` handler in `src/bun/handlers/tasks.ts`: query all rows in `enabled_models` for the current workspace, return as `ModelInfo[]` with `contextWindow: null` (flat list, no provider fetch required at this stage)

## 6. Frontend Store

- [x] 6.1 Add `enabledModels` ref and `loadEnabledModels()` action to `src/mainview/stores/task.ts` that calls `models.listEnabled`
- [x] 6.2 Add `allProviderModels` ref and `loadAllModels()` action to `src/mainview/stores/task.ts` that calls `models.list` (used by the tree view)
- [x] 6.3 Add `setModelEnabled(qualifiedModelId: string, enabled: boolean)` action to `src/mainview/stores/task.ts` that calls `models.setEnabled` and updates `allProviderModels` optimistically
- [x] 6.4 Update the existing `loadAvailableModels()` call site in `src/mainview/stores/task.ts` to use `loadEnabledModels()` instead of `models.list`

## 7. ModelTreeView Component

- [x] 7.1 Create `src/mainview/components/ModelTreeView.vue` with a provider-grouped tree layout: one collapsible section per provider, each showing its models with checkboxes
- [x] 7.2 Call `loadAllModels()` in `onMounted` inside `ModelTreeView.vue`; render a loading state while the fetch is in progress
- [x] 7.3 Render provider rows with an error message and "Refresh" button when `ProviderModelList.error` is set
- [x] 7.4 Wire each model checkbox to `setModelEnabled(model.id, checked)` in `ModelTreeView.vue`
- [x] 7.5 Implement per-provider Refresh: clicking the button calls `loadAllModels()` and updates only that provider's models in the rendered list

## 8. ManageModelsModal Component

- [x] 8.1 Create `src/mainview/components/ManageModelsModal.vue` as a modal overlay that renders `ModelTreeView` inside
- [x] 8.2 Emit a `close` event from `ManageModelsModal.vue` when the user clicks outside the modal or a close button

## 9. Config Screen: Models Tab

- [x] 9.1 Add a "Models" tab to the config/setup screen (`src/mainview/views/SetupView.vue` or equivalent) that renders `ModelTreeView`

## 10. Chat Drawer: Model Dropdown Updates

- [x] 10.1 Update the model dropdown in `src/mainview/components/TaskDetailDrawer.vue` to source from `enabledModels` (via `loadEnabledModels`) instead of the old `models.list` flat list
- [x] 10.2 Replace the current PrimeVue `Select` with a filterable grouped variant: transform `enabledModels` into `[{ label: providerId, items: ModelInfo[] }]`, set `optionGroupLabel="label"`, `optionGroupChildren="items"`, and `filter` props on `Select`
- [x] 10.3 Add a "⚙ Manage models" footer slot inside the `Select` panel that opens `ManageModelsModal` and closes the dropdown
- [x] 10.4 Implement empty state: when `enabledModels` is empty, show the `Select` with a placeholder "No models enabled" (disabled) and the "⚙ Manage models" footer slot
- [x] 10.5 After `ManageModelsModal` closes, refresh `enabledModels` by calling `loadEnabledModels()` so the dropdown reflects changes
