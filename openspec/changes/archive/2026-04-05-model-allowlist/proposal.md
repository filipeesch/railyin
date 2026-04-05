## Why

When multiple AI providers are configured (Anthropic, LM Studio, OpenRouter, etc.), the model dropdown in the chat window becomes unmanageable — a flat list of 50+ models with no way to filter. Users need a curated shortlist of models they actually want to use, manageable without editing config files.

## What Changes

- **BREAKING**: `models.list` RPC response shape changes — returns provider-grouped data with per-model enabled flags instead of a flat `ModelInfo[]`
- New `models.setEnabled` RPC to toggle individual models on/off (stored in DB)
- New `models.listEnabled` RPC returning only the user's enabled models for the chat dropdown
- New DB table `enabled_models` (workspace_id, qualified_model_id)
- Config screen gains a "Models" tab with a provider tree view and enable/disable checkboxes
- Chat model dropdown switches to `listEnabled`, groups results by provider, adds a "⚙ Manage models" button that opens an inline modal
- Empty state (no models enabled) shows a CTA directing user to the modal

## Capabilities

### New Capabilities

- `model-allowlist`: Per-workspace enabled model list stored in DB; users curate which models appear in the chat selection UI

### Modified Capabilities

- `model-selection`: The chat model selector now shows only enabled models grouped by provider, with a manage shortcut; was a flat unfiltered list

## Impact

- `src/bun/db/migrations.ts` — new `enabled_models` table
- `src/bun/handlers/tasks.ts` — `models.list` rewritten, `models.setEnabled` + `models.listEnabled` added
- `src/shared/rpc-types.ts` — updated `models.list` type, two new RPC entries
- `src/mainview/views/SetupView.vue` — new Models tab
- `src/mainview/components/TaskDetailDrawer.vue` — new grouped dropdown + manage modal trigger
- New `src/mainview/components/ModelTreeView.vue` — shared tree component used in both config tab and modal
- New `src/mainview/components/ManageModelsModal.vue` — modal wrapper
- `src/mainview/stores/task.ts` — switch to `listEnabled`, add `setEnabled` action
