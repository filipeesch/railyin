## 1. RPC Contract

- [x] 1.1 Add `allowedTransitions?: string[]` to the `WorkflowColumn` interface in `src/shared/rpc-types.ts`
- [x] 1.2 Map `allowed_transitions` → `allowedTransitions` in `templateToWorkflowTemplate()` in `src/bun/handlers/boards.ts`

## 2. TransitionValidator Module

- [x] 2.1 Create `src/bun/workflow/transition-validator.ts` with `validateTransition(db, taskId, toState)` returning `{ ok: true, fromCol, toCol } | { ok: false, reason: string }`
- [x] 2.2 Implement column-existence check inside the validator (returns error if toState is not a valid column ID in the template)
- [x] 2.3 Implement capacity check inside the validator (replicates current limit logic, using `getWorkspaceConfig(wsKey)` resolved from board's `workspace_key`)
- [x] 2.4 Implement `allowed_transitions` check inside the validator (check source column's list; skip if list is absent/empty)

## 3. Backend Enforcement

- [x] 3.1 Replace the inline capacity guard in `tasks.transition` (`src/bun/handlers/tasks.ts`) with a call to `validateTransition`; throw if `!result.ok`; also extend the JOIN query to include `t.workflow_state` for the source column
- [x] 3.2 Replace the inline column-existence and capacity guard in `execMoveTask` (`src/bun/workflow/tools/board-tools.ts`) with a call to `validateTransition`; return error string if `!result.ok`

## 4. Frontend — Forbidden Column UX

- [x] 4.1 Extract duplicated standalone/grouped column template into a new `src/mainview/components/BoardColumn.vue` component with props: `column`, `tasks`, `isDragOver`, `isAtCapacity`, `isForbidden`, `dropIndicatorY`; emit the existing card events
- [x] 4.2 Add `is-drag-forbidden` CSS class to `BoardColumn.vue` (dimmed opacity, `not-allowed` cursor pointer); apply `not-allowed` cursor override in `onPointerMove` when hovering a forbidden column
- [x] 4.3 Add `forbiddenColumnIds` computed in `BoardView.vue`: derives forbidden set from `activeDrag.sourceColumnId` → source column's `allowedTransitions`; empty set when no drag active or no `allowedTransitions` on source column; always excludes the source column itself
- [x] 4.4 Replace the two duplicated column blocks in `BoardView.vue` with `<BoardColumn>` using the new computed; pass `isForbidden` from `forbiddenColumnIds`
- [x] 4.5 In `onPointerUp`, add forbidden-column gate alongside the existing capacity gate: skip transition if `forbiddenColumnIds` contains `targetColumnId`

## 5. Config / Documentation

- [x] 5.1 Add `allowed_transitions` example (commented out) to `config/workflows/delivery.yaml` with a comment explaining the semantics
- [x] 5.2 Add `allowed_transitions` field to the default template returned by `getDefaultTemplate()` in `src/bun/config/index.ts` (as optional/undefined — just ensure the type is correctly handled)
- [ ] Write and run e2e tests for board-allowed-transitions
