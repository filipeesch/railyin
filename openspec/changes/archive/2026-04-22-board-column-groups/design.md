## Context

The board view renders workflow columns as a horizontal flex row. Each column maps 1:1 to a `WorkflowColumnConfig` in the YAML. As workflows grow, boards become wide and shallow — many columns with few cards create a lot of empty vertical space and require horizontal scrolling.

Two pre-existing bugs are included in this change:
1. **Position float collapse** — `MIN(position) / 2` applied repeatedly eventually produces positions indistinguishable to IEEE 754 doubles. Cards placed at the top of a dense column can silently land in the wrong order.
2. **Drag ghost stutter** — `onPointerUp` `await`s the full `tasks.transition` RPC before removing the ghost element and restoring the source card opacity, causing a visible ~200–500ms snap.

Current task position formula (from `card-column-placement` spec): insert at top = `MIN(pos) / 2`, empty column = `500`.

## Goals / Non-Goals

**Goals:**
- Let users cluster related columns into a vertical stack within one horizontal slot, reducing board width.
- Enforce per-column card limits (WIP limits) in both the UI and backend.
- Fix position float collapse via rebalancing.
- Make drag-and-drop feel instant (true optimistic UI).

**Non-Goals:**
- Collapsible groups (not requested).
- Swimlane / row-based layout.
- Workspace-level default limits.
- Combined card count badge on the group header.

## Decisions

### Decision 1: `groups` as a separate top-level YAML key

**Choice**: Add `groups?: { id, label?, columns: string[] }[]` to `WorkflowTemplateConfig`. The `columns` array remains flat and unchanged.

**Rationale**: Zero breaking changes — existing workflows need no edits. Groups are purely a _display overlay_: the canonical column order, IDs, and all engine logic (`on_enter_prompt`, `tools`, `model`) remain anchored to the `columns` array. The group section only says "these column IDs share a horizontal slot".

**Alternative rejected**: Nested `columns` inside a `group` type entry. This would require the config parser and all engine code that walks `template.columns.find(c => c.id)` to handle a union type, introducing breakage across ~15 call sites.

### Decision 2: Render order derived by walking `columns` array

**Choice**: When rendering, walk the `columns` array in order. For each column, check if it belongs to a group. Emit a group slot on the _first encounter_ of any column from that group; subsequent columns in the same group are rendered as stacked sub-columns inside the already-emitted slot.

**Rationale**: Single source of truth for order. No need for a separate `order` field on groups. Groups with a single column render exactly as a standalone column (no group chrome) — a degenerate case that should not surprise users.

### Decision 3: Card limit is a hard block at both UI and backend layers

**Choice**: UI checks `columnTasks(targetId).length >= column.limit` before calling the API (no round-trip for the blocked path). Backend (`tasks.transition` RPC + `move_task` agent tool) also enforces the limit as a hard error. No "warn and allow" mode.

**Rationale**: WIP limits must be trustworthy. The frontend check is UX (instant feedback); the backend check is the authoritative guard against races (two users, agent + human simultaneously). Columns with no `limit` field are unlimited.

**Visual feedback**: Column badge turns red/amber when at capacity; drop is rejected (no optimistic move, outline stays dashed-red during hover over full column).

### Decision 4: Position rebalancing on gap collapse

**Choice**: After any position write, check if the minimum gap between adjacent positions in the column is below `1.0`. If so, rewrite all positions in that column as `1000, 2000, 3000, ...` (integer multiples of 1000) in current sort order.

**Rationale**: Prevents float exhaustion without changing the user-visible order. Rebalancing is rare (only after ~50 consecutive top-inserts), cheap (one SELECT + N UPDATEs on a small set), and safe (positions are internal, not user-visible).

**Where**: Extracted as `rebalanceColumnPositions(db, boardId, columnId)` helper called after each position write in `handlers/tasks.ts`.

### Decision 5: Truly optimistic drag-and-drop

**Choice**: In `onPointerUp`, immediately remove the ghost and restore source card opacity, then fire the store transition as a background promise. On error, revert via the existing `_replaceTask(prior)` path.

**Rationale**: The store already does an optimistic `_replaceTask` inside `transitionTask`. The only thing preventing instant feedback was the `await` wrapping the entire operation (including ghost cleanup) in `onPointerUp`. Decoupling cleanup from the network call makes drops feel instant.

## Risks / Trade-offs

- **Race on limit check**: Two clients drag a card into a column that has one free slot simultaneously. Both pass the frontend check. The backend handles this: the second write will see count = limit, return an error, and the frontend reverts the optimistic move. One user sees a brief snap-back — acceptable.
- **Rebalancing and concurrent writes**: Rebalancing rewrites positions for an entire column. If two writes happen concurrently, the last one wins but both are valid (no duplicates, just one rebalance may be lost). The next insert will re-trigger rebalancing if needed.
- **Single-column groups**: If a user declares a group with one column, it renders identically to a standalone column. This is intentional but may surprise users who expect visible group chrome. Documented as expected behaviour.

## Migration Plan

- No database migrations required.
- YAML change is additive. All existing `config/workflows/*.yaml` files remain valid.
- No feature flags needed — the groups key is simply absent in existing files, which is equivalent to "no groups".

## Open Questions

- Should the group header display any label? Decision: **no label by default** (group label field is optional and unused in MVP). Can be added later.
- Should `TaskDetailDrawer` column-select dropdown visually group options? **Nice-to-have, out of scope for this change.**
