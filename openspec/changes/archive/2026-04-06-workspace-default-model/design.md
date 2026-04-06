## Context

The workflow engine applies a model to a task when it transitions between columns (`engine.ts` ~L695). Currently, if the destination column has no `model` field, the task's model is left unchanged. If the task was just created (model = NULL), it proceeds with no model, which eventually causes the engine to move the task to `awaiting_user` to prompt the user to pick one.

There is no workspace-level fallback. Users either have to set `model` on every column in every workflow YAML, or manually pick a model for every new task.

## Goals / Non-Goals

**Goals:**
- Add an optional `default_model` field to `workspace.yaml` (fully-qualified: `providerId/modelId`).
- Apply it as a fallback in two places: column transitions (when column has no `model`) and task creation (when no model is explicitly passed by the caller).
- Document the field in `workspace.yaml.sample`.

**Non-Goals:**
- UI for setting the workspace default model (can be added separately).
- Per-board default model.
- Overriding a column's explicitly configured `model`.
- Changing the model-allowlist or model-selection UI behavior.

## Decisions

### D1: Field location — top-level `default_model` in `WorkspaceYaml`

`WorkspaceYaml` gets a new `default_model?: string` field. It is read directly from the loaded config object wherever needed.

**Alternatives considered:**
- Nesting under `ai:` — the `ai:` block is deprecated; adding to it would perpetuate a legacy format.
- Per-provider default — too granular and doesn't map to user intent.

### D2: Resolution chain — column > workspace default > unchanged

In `engine.ts` `moveTaskToColumn()`, the model update logic becomes:

```
if column.model != null  →  set task.model = column.model
else if workspace.default_model != null  →  set task.model = workspace.default_model
else  →  do nothing (leave task.model as-is)
```

Column model continues to take full precedence. The workspace default only fills the gap when a column has no preference.

**Alternative:** Always reset to null when column has no model, then fill from workspace default. Rejected — it would clear a model the user manually set on the task and then immediately replaced it with the workspace default, which is the same result but noisier.

### D3: Task creation — apply workspace default when no model passed

In `create_task` tool (`tools.ts`), when the caller provides no `args.model`, use `workspace.default_model` (if set) as the initial model. This means newly created tasks start life with the workspace default rather than NULL.

### D4: No config validation — field is entirely optional

`default_model` is optional. If absent or null, behavior is identical to today. No startup error is raised.

## Risks / Trade-offs

- **Stale model ID**: If a user removes a provider and forgets to update `default_model`, executions will fail with an unresolvable provider error — same as today for column-level `model` fields. No special handling needed.
- **Existing tasks unaffected**: Tasks already in flight keep whatever model they have; the workspace default only applies on next column transition or creation.

## Migration Plan

No database schema changes. No migration required. The change is fully additive — existing `workspace.yaml` files without `default_model` behave identically to today.
