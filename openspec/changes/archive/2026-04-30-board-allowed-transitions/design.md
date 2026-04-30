## Context

The board workflow system has two paths that can move a card between columns:
1. **Human drag-and-drop** → `tasks.transition` RPC handler (`src/bun/handlers/tasks.ts`)
2. **AI agent `move_task` tool** → `execMoveTask` (`src/bun/workflow/tools/board-tools.ts`)

Both paths already enforce the column `limit` (capacity) constraint introduced in the `column-card-limit` feature, but the enforcement logic is duplicated — each path has its own inline query and check. Additionally, `execMoveTask` uses `getConfig()` (global singleton, no workspace-key awareness) while `tasks.transition` correctly uses `getWorkspaceConfig(wsKey)`, creating a latent multi-workspace bug.

The `allowed_transitions` config field already exists on `WorkflowColumnConfig` in `src/bun/config/index.ts:115` and is parsed from YAML. It is silently dropped by `templateToWorkflowTemplate()` in `src/bun/handlers/boards.ts` and never reaches the `WorkflowColumn` RPC type or the frontend.

The board's `BoardView.vue` has the column template block fully duplicated (~36 lines × 2) for standalone columns and grouped columns, making it hard to add new column-state CSS classes consistently.

## Goals / Non-Goals

**Goals:**
- Enforce `allowed_transitions` in both the RPC and agent-tool paths
- Surface the constraint to the frontend so forbidden drop targets are visually obvious before a drop is attempted
- Extract a `TransitionValidator` module that unifies all transition guard logic (column existence, capacity, allowed_transitions)
- Fix the `getConfig()` vs `getWorkspaceConfig()` divergence in `execMoveTask`
- Extract a `BoardColumn.vue` component to eliminate the duplicated template

**Non-Goals:**
- UI for editing `allowed_transitions` in the workflow YAML editor — YAML editing is already supported; this feature only adds the enforcement
- Direction-awareness beyond source-column rules (no "from any column to X" rules — that is `allowed_from` semantics, not the chosen approach)
- Persisting transition history or audit log
- Validating `allowed_transitions` values at YAML load time (undefined column IDs simply never match and cause no transitions to be blocked unexpectedly)

## Decisions

### D1: Enforce on the source column (not target)

`allowed_transitions` is declared on the column the card is leaving, listing which target column IDs are reachable. Alternative: declare `allowed_from` on the target column (which source columns may deliver cards here). 

Rationale: the field already exists with source-column semantics in the config type; the test fixture already uses it this way; the natural reading ("from plan you can go to in_progress") matches how workflow authors think about state machines.

### D2: Extract `TransitionValidator` as a pure function module

Rather than adding another inline block to both `tasks.transition` and `execMoveTask`, a single `validateTransition(db, taskId, toState)` function in `src/bun/workflow/transition-validator.ts` performs all checks and returns a typed result:

```
type TransitionResult =
  | { ok: true;  fromCol: WorkflowColumnConfig; toCol: WorkflowColumnConfig }
  | { ok: false; reason: string }
```

Callers handle the error differently:
- `tasks.transition` → `throw new Error(result.reason)`
- `execMoveTask` → `return \`Error: ${result.reason}\``

This is a deliberate SRP boundary: the validator owns "is this allowed?" and nothing else.

The validator also closes a gap where `tasks.transition` currently does NOT validate that `toState` is a real column (only `execMoveTask` did). Both now share that check.

### D3: Fix workspace config resolution in board-tools

`execMoveTask` currently calls `getConfig()` which returns the last-loaded config regardless of workspace. The validator resolves workspace key from the board's `workspace_key` column and calls `getWorkspaceConfig(wsKey)`, making both paths workspace-correct.

### D4: Frontend pre-flight dim — not post-drop rejection

Forbidden columns get `is-drag-forbidden` CSS class applied as soon as drag starts (derived from the source card's column `allowedTransitions`), not only on hover. The drop is also silently rejected in `onPointerUp` (same position as capacity check). 

This is preferred over: (a) server-error toast after drop attempt — too late, feels broken; (b) hiding columns — layout shifts are disorienting.

### D5: Extract `BoardColumn.vue`

The standalone and grouped column blocks in `BoardView.vue` are structurally identical. Props: `column`, `tasks`, `isDragOver`, `isAtCapacity`, `isForbidden`, `dropIndicatorY`. Emits mirror the existing event handlers. This is the correct vehicle for adding `isForbidden` once instead of twice, and it reduces `BoardView.vue` from ~890 to ~620 lines.

## Risks / Trade-offs

- **Optimistic UI + server rejection mismatch**: `transitionTask` in the task store does an optimistic move before the RPC resolves. If the server rejects (allowed_transitions violated), the `catch` block reverts via `_replaceTask(prior)`. This is already the pattern for capacity errors — no new risk, but the snap-back is visible. Mitigation: the pre-flight dim should prevent most cases from reaching the server.

- **`allowed_transitions` referencing non-existent column IDs**: An author may typo a column ID. The validator treats the allow-list literally — a typo silently makes that target unreachable. Mitigation: non-goals intentionally exclude YAML validation; a future lint step could catch this.

- **Same-column reorder**: Same-column reorder is never a transition — `onPointerUp` gates the transition branch with `targetColumnId !== dragSnapshot.sourceColumnId`. The forbidden computed must also exclude the source column from the forbidden set to avoid dimming the card's own column.

## Migration Plan

No database migration required. The feature is purely additive:
- Existing YAMLs without `allowed_transitions` continue to work — omission means open (all transitions allowed)
- No config version bump needed
- Deploy is a standard build+restart

## Open Questions

- None — all design decisions are resolved above.
