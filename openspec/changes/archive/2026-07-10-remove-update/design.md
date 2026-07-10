## Context

The `resetStuckTasks()` function in `src/bun/index.ts` runs at app bootstrap. It queries the SQLite database for any tasks with `execution_state` of `running` or `waiting_user` and forcibly sets them to `failed`, also updating related executions. This was added as a crash-recovery safety net during the initial bootstrapping phase.

The current code is an inline function defined and called directly in `index.ts` — a monolithic bootstrap file. It has no tests, no configuration, and no user-facing surface. Its only observable effects are: (1) a `console.warn` log line, and (2) silent DB mutations.

## Goals / Non-Goals

**Goals:**
- Remove the `resetStuckTasks()` function and its invocation from `src/bun/index.ts`
- Remove the corresponding requirement from the `workflow-engine` spec
- Ensure no other code depends on this behavior

**Non-Goals:**
- Adding a new manual recovery mechanism (CLI, API endpoint, etc.)
- Adding tests for this removal (handled separately)
- Refactoring the `index.ts` bootstrap monolith (out of scope)

## Decisions

1. **Inline deletion vs. extraction to a separate module**
   - **Decision**: Delete inline. The function is only 16 lines, called once, with no reuse. Extracting would add a new file and import for no benefit.

2. **Spec delta format: REMOVED vs. MODIFIED**
   - **Decision**: Use `REMOVED Requirements`. The requirement is being fully deprecated — there is no replacement behavior to describe, just the absence of auto-recovery.

3. **No replacement recovery mechanism**
   - **Decision**: Do not add a manual recovery endpoint or CLI command. Users can use the existing UI (drag-and-drop, retry button, manual transition) to handle stuck tasks. This keeps the change minimal and focused.

## Risks / Trade-offs

| Risk | Mitigation |
|---|---|
| Tasks left in `running` state after crash are invisible to the user | The board UI shows execution_state on cards. Users can spot stuck tasks and manually transition them. |
| `waiting_user` tasks block the queue | Same — users see the card in the board and can drag it to a new column. |
| Spec archive loses the removal context | The delta spec explicitly documents the removal with reason and migration notes. |

## Migration Plan

1. Delete `resetStuckTasks()` function and call from `src/bun/index.ts`
2. Create delta spec removing the "Stale running state reset on startup" requirement from `workflow-engine`
3. No deployment steps needed — this is a code-only change with no DB schema impact

## Open Questions

None identified. The change is a straightforward removal with no dependencies or edge cases.
