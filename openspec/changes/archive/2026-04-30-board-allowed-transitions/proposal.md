## Why

Workflow authors have no way to restrict which columns a card can move to, so users and the AI agent can freely transition cards in any direction — skipping required stages or reversing to earlier states. This breaks intended process flows like requiring plan before in-progress, or preventing direct backlog-to-done jumps.

## What Changes

- Workflow YAML columns gain an optional `allowed_transitions` field: a list of column IDs the card may move to from that column. When omitted, all transitions remain allowed (backward compatible).
- The `tasks.transition` RPC enforces the constraint server-side and throws an error when a transition is not in the allowed list.
- The `move_task` AI agent tool enforces the same constraint and returns an error string.
- A new `TransitionValidator` module centralises all transition-guard logic (column existence check, capacity check, allowed-transitions check) removing the duplication between the two enforcement paths and fixing a latent `getConfig()` vs `getWorkspaceConfig()` bug in `execMoveTask`.
- The `WorkflowColumn` RPC type is extended to carry `allowedTransitions` to the frontend.
- The board UI dims forbidden columns as soon as a drag starts and changes the cursor to `not-allowed` on hover; dropping on a forbidden column is silently rejected.
- A `BoardColumn.vue` component is extracted from `BoardView.vue` to eliminate the duplicated standalone/grouped column template blocks and to give a single place for all column-state CSS classes.

## Capabilities

### New Capabilities

- `column-allowed-transitions`: Workflow YAML columns may declare `allowed_transitions: [<column-id>, ...]` to restrict which target columns are reachable from that column. The constraint is enforced by both the RPC handler and the AI agent tool, and communicated proactively in the board UI during drag.

### Modified Capabilities

- `column-card-limit`: The existing card-limit enforcement in `tasks.transition` and `execMoveTask` is being refactored into the new `TransitionValidator` module. No spec-level behaviour changes — same rules, different code location.

## Impact

- **Backend**: `src/bun/handlers/tasks.ts` (transition guard), `src/bun/workflow/tools/board-tools.ts` (execMoveTask guard), new `src/bun/workflow/transition-validator.ts`
- **RPC contract**: `src/shared/rpc-types.ts` — `WorkflowColumn` gains `allowedTransitions?: string[]`
- **Board handler**: `src/bun/handlers/boards.ts` — `templateToWorkflowTemplate` maps the new field
- **Frontend**: `src/mainview/views/BoardView.vue` (drag-drop forbidden logic), new `src/mainview/components/BoardColumn.vue`
- **Config/YAML**: `config/workflows/delivery.yaml` — field documented; default template in `config/index.ts` updated
- **No breaking changes** — omitting `allowed_transitions` preserves current permissive behaviour
