## Why

Boards with many workflow columns force excessive horizontal scrolling, while simple columns (Backlog, Done) waste vertical space. We need a way to pack related columns vertically into a single horizontal slot, better utilising the screen. Two pre-existing drag-and-drop bugs are also fixed in scope: floating-point position collapse (cards can no longer be placed at the top after many inserts) and a drag ghost stutter (the card snaps only after the API round-trip completes instead of immediately).

## What Changes

- **New `groups` key in workflow YAML** — optional top-level array that clusters existing column IDs into a named vertical stack occupying one horizontal slot. Fully backward compatible: workflows without `groups` render exactly as before.
- **New `limit` field on `WorkflowColumnConfig`** — integer cap on cards in a column. When set, moves that would exceed the limit are hard-blocked both in the UI (visual feedback, drop rejected) and in the backend (`tasks.transition` RPC and `move_task` agent tool return an error). Columns without a limit are unlimited.
- **Position rebalancing** — when adjacent card positions collapse below a threshold (gap < 1), the entire column is rebalanced with even spacing to prevent IEEE 754 float exhaustion.
- **Optimistic drag-and-drop** — the ghost element and source card opacity are removed immediately on drop; the store update is fire-and-forget; on API error the card reverts to its original column and position.

## Capabilities

### New Capabilities
- `column-groups`: Visual grouping of existing workflow columns into a stacked vertical slot on the board, configured via a top-level `groups` key in workflow YAML.
- `column-card-limit`: Per-column card cap enforced in the UI and backend; moves that exceed the limit are rejected with clear feedback.

### Modified Capabilities
- `card-column-placement`: Position halving formula can now trigger a full-column rebalance when gaps collapse below threshold; optimistic UI behaviour on drag-and-drop is now truly fire-and-forget.

## Impact

- `config/workflows/*.yaml` — new `groups` array and `limit` field (additive, backward compatible)
- `src/bun/config/index.ts` — `WorkflowColumnConfig` gains `limit?: number`; `WorkflowTemplateConfig` gains `groups?: WorkflowColumnGroup[]`
- `src/shared/rpc-types.ts` — same additions mirrored to `WorkflowColumn` / `WorkflowTemplate`
- `src/bun/handlers/tasks.ts` — `tasks.transition` checks column card count against limit
- `src/bun/workflow/tools.ts` — `move_task` agent tool checks same limit (hard error)
- `src/mainview/views/BoardView.vue` — render groups as stacked sub-columns; optimistic drag ghost cleanup; capacity-blocked drop
- `src/mainview/stores/task.ts` — position rebalance helper; fire-and-forget transition wrapper
