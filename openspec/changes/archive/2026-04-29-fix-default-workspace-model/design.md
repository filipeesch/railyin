## Context

The workspace config (`workspace.yaml`) supports an `engine` block with an optional `model` field — the "Default model" visible and editable in the Settings → Models UI. This field is correctly persisted by `workspace.update` and returned by `workspace.getConfig`, but the three task execution paths (`TransitionExecutor`, `HumanTurnExecutor`, `RetryExecutor`) do not include `engine.model` in their model resolution chain. The `tasks.create` handler also ignores it, so new tasks are born with `model = NULL` in the DB.

The net result: a user who sets a workspace default model will see it reflected in the UI settings page, but every execution uses the engine's built-in default instead. `ChatExecutor` (standalone session chat) and `board-tools.ts` (AI-created tasks) already resolve `engine.model` correctly — the bug is isolated to the three task execution executors and the `tasks.create` RPC handler.

## Goals / Non-Goals

**Goals:**

- Resolve `engine.model` as a fallback in `TransitionExecutor`, `HumanTurnExecutor`, and `RetryExecutor` when neither column nor task model is set.
- Seed `task.model = engine.model` at `tasks.create` time so the model is visible in the chat dropdown immediately.
- Extract a single `resolveTaskModel()` pure function as the canonical source of the resolution chain.
- Update `openspec/specs/model-selection/spec.md` to align scenarios with the `engine.model` source (current spec references legacy `default_model`).

**Non-Goals:**

- No changes to the frontend model dropdown or `ConversationInput` component.
- No DB schema changes.
- No changes to `ChatExecutor` or `board-tools.ts` (already correct).
- No changes to the `workspace.update` / `workspace.getConfig` API surface.
- Testing is out of scope for this change (tracked separately).

## Decisions

### D1: Pure `resolveTaskModel()` utility in `src/bun/engine/execution/model-resolver.ts`

**Decision:** Extract a pure function `resolveTaskModel(columnModel, taskModel, engineConfig): string` that encodes the full priority chain: `column → task → engine.model → ""`.

**Rationale:** `ChatExecutor` and `board-tools.ts` both inline the same resolution pattern independently and have already diverged slightly. A shared pure function is testable in isolation, surfaces the design intent explicitly, and prevents future executors from implementing the chain differently.

**Alternative considered:** Inline the 2-line pattern per executor. Rejected — the pattern will be repeated in 3 executors and the chain is a product decision (not trivial implementation detail) that benefits from a named, discoverable home.

```ts
// src/bun/engine/execution/model-resolver.ts
import type { EngineConfig } from "../../config/index.ts";

export function resolveTaskModel(
  columnModel: string | null | undefined,
  taskModel: string | null | undefined,
  engineConfig: EngineConfig,
): string {
  const engineDefault = "model" in engineConfig ? (engineConfig.model ?? null) : null;
  return columnModel ?? taskModel ?? engineDefault ?? "";
}
```

### D2: Seed `task.model` at `tasks.create` only when `engine.model` is set

**Decision:** In the `tasks.create` handler, read `engine.model` from the workspace config and include it in the `INSERT` only when non-null/non-empty. The INSERT is conditional (model column added to query only if a value exists) — consistent with how `board-tools.ts` already handles this.

**Rationale:** Writing an empty string or null explicitly offers no benefit over not writing it. Keeping `task.model = NULL` as the "no model configured" sentinel is semantically cleaner and avoids polluting DB state. Existing tasks with `model = NULL` are handled by the executor fallback introduced in D3.

**Alternative considered:** Always seed (even empty string). Rejected — empty string ≠ null in some comparisons, creating subtle bugs.

### D3: Write resolved `engine.model` back to DB in HumanTurnExecutor and RetryExecutor

**Decision:** When `task.model` is NULL at execution time and `engine.model` resolves it, write the resolved model back to `task.model` in the DB before building execution params.

**Rationale:** Consistent with `TransitionExecutor`'s existing behavior (lines 45-49 already write resolved model back). Persisting means subsequent human turns and retries find the model directly in the DB without re-resolving from config — and the model dropdown in the UI correctly reflects what's being used.

**Alternative considered:** Runtime-only resolution (don't persist). Rejected — the chat dropdown reads `task.model` from the task object; if we don't persist, the dropdown shows "Auto/null" even while the engine is using `engine.model`. User experience would be confusing.

### D4: Model priority chain (final)

```
column.model  →  task.model  →  engine.model  →  ""
    (YAML)         (DB, user       (workspace        (engine
                    or seeded       settings)          picks)
                    at creation)
```

- **Column model overrides task model** — workflow YAML controls execution model per phase.
- **Task model is preserved when column has no model** — user's chat dropdown selection survives column transitions that don't declare a model.
- **`engine.model` is a workspace-wide fallback** — applied only when neither column nor task has a model set.

## Risks / Trade-offs

- **Existing tasks with `model = NULL`** will have `engine.model` written to their DB `model` field on the next execution if `engine.model` is configured. This is the desired behavior but is a one-way migration (no automatic rollback). Risk is low — users can manually clear the model via the dropdown.

- **`engine.model` changes don't retroactively update tasks** — if a user changes the workspace default model after tasks have been created/executed, existing tasks retain whatever model was seeded/written. This is intentional (task model is a per-task override) and consistent with the existing column-model behavior.

- **`model-resolver.ts` type dependency** — the utility imports `EngineConfig` from `../../config/index.ts`. This is a shallow import with no circular risk. If `EngineConfig` shape changes (e.g., new engine type added without `model` field), the `"model" in engineConfig` guard handles it safely.

## Migration Plan

No DB schema changes. No data migration scripts needed. The behavioral change is forward-only:
- New tasks created after the fix will have `task.model` seeded.
- Existing NULL-model tasks get `engine.model` written on their next execution.
- No deployment steps beyond the normal release.
- Rollback: revert the code; tasks may retain the written model value but the engine will not re-override it (task model takes precedence over engine model).

## Open Questions

_(none — all decisions made during design session)_
