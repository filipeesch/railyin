## Context

The `allowed_transitions` feature (commit `6c0d28c`) wired the backend validator and Board drag-and-drop to respect per-column transition constraints, but the workflow column `Select` in `TaskChatView.vue` was left unchanged. It still computes:

```ts
const columns = computed(() => boardStore.activeBoard?.template.columns ?? []);
```

…returning every column with no filtering. The backend rejects the move when an invalid column is chosen, but this only surfaces as an error after the user has already clicked — a confusing experience.

The `forbiddenColumnIds` computed in `BoardView.vue` already implements the right filtering logic for drag-and-drop. Both use cases share the same core rule: _given a source column and its optional `allowedTransitions` list, which target columns are reachable?_

## Goals / Non-Goals

**Goals:**
- Fix the Task Drawer column Select to show only the current column (disabled) plus valid transition targets
- Extract the shared filtering logic into a composable to eliminate duplication between `TaskChatView.vue` and `BoardView.vue`
- Keep full backward-compatibility: when `allowedTransitions` is absent, all columns are available

**Non-Goals:**
- Changing backend transition enforcement (already correct)
- Adding `allowedTransitions` to the YAML sample config (already documented)
- Changing the drag-and-drop visual behaviour (already correct)
- Adding Playwright E2E tests for the Select (deferred, not in scope)

## Decisions

### Decision 1 — Shared composable over local fix or store method

**Choice:** Extract `useColumnTransitions` in `src/mainview/composables/`.

**Rationale:** The filtering algorithm is already duplicated between the future `TaskChatView` fix and the existing `BoardView` inline computed. A composable:
- Lives in the right layer (view logic, not store data)
- Can be unit-tested without a full Pinia setup
- Gives `BoardView` a clean refactor to remove its 12-line inline computed

**Alternatives considered:**
- _Local fix in TaskChatView only_ — leaves the duplication; next consumer will copy-paste again
- _Store method on boardStore_ — mixes selection/presentation logic into the data store (violates SRP)

---

### Decision 2 — Separate pure function + composable wrapper

**Choice:** Export both `getValidTransitionColumns(template, fromColumnId)` (pure function) and `useColumnTransitions(template, currentColumnId)` (Vue composable wrapper).

**Rationale:** The core algorithm has zero reactive dependencies — it's a pure data transform. Separating it means:
- Tests exercise the pure function directly (no Vue mock needed, as in `useCommandsCache.test.ts` pattern)
- The composable is a thin wrapper of `computed(() => getValidTransitionColumns(...))` 

---

### Decision 3 — Current column shown as disabled in the Select

**Choice:** Current column appears in the Select, `disabled: true`. Forbidden columns are excluded entirely.

**Rationale:** Showing the current state (disabled) gives the user a clear visual anchor — they can see where they are before picking a target. Completely hiding it would require a separate indicator.

**Implementation:** `TransitionColumn` extends `WorkflowColumn` with `disabled: boolean`. PrimeVue `Select` supports `option-disabled="disabled"` to grey out individual items.

---

### Decision 4 — `BoardView.vue` inline computed refactored to use composable

**Choice:** Replace `forbiddenColumnIds` inline computed in `BoardView.vue` with `useColumnTransitions(template, draggingSourceColumnId).forbiddenColumnIds`.

**Rationale:** The composable already returns `forbiddenColumnIds: ComputedRef<Set<string>>` to serve exactly this use case. Refactoring `BoardView` to consume it removes the last copy of the algorithm, and the component behaviour is unchanged.

## Composable API

```
src/mainview/composables/useColumnTransitions.ts

export interface TransitionColumn extends WorkflowColumn {
  disabled: boolean;   // true only when id === currentColumnId
}

// Pure function — testable without Vue
export function getValidTransitionColumns(
  template: WorkflowTemplate | undefined,
  fromColumnId: string | null | undefined,
): TransitionColumn[]

// Vue composable — used by components
export function useColumnTransitions(
  template: MaybeRef<WorkflowTemplate | undefined>,
  currentColumnId: MaybeRef<string | null | undefined>,
): {
  selectableColumns: ComputedRef<TransitionColumn[]>   // for TaskChatView Select
  forbiddenColumnIds: ComputedRef<Set<string>>          // for BoardView drag-and-drop
}
```

**Filtering rules in `getValidTransitionColumns`:**

| `allowedTransitions` on source col | Result |
|---|---|
| `undefined` (not configured) | All columns; source col has `disabled: true` |
| `[]` (empty array — frozen) | Only source col, `disabled: true` |
| `["col-a", "col-b"]` | Source col (`disabled: true`) + col-a + col-b |
| `template` is `undefined` | Empty array (Select hidden via `v-if`) |

**`forbiddenColumnIds` derivation from `selectableColumns`:**
```
forbiddenColumnIds = all column IDs
  minus currentColumnId (source)
  minus selectable IDs that are not disabled
```

## Risks / Trade-offs

- **PrimeVue `optionDisabled` field name collision** — if a `WorkflowColumn` ever gains a `disabled` field in `rpc-types.ts`, the `TransitionColumn` extension would shadow it. Mitigation: the field is not in the current type; name it `disabled` (matches PrimeVue convention) and note the dependency in code.
- **No-op transition guard** — if `transition()` in `TaskChatView` is somehow called with the current column ID (programmatically, not via UI), the backend would reject it. Added `if (toState === task.value.workflowState) return;` guard as cheap defensive measure.
