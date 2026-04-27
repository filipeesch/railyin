## 1. Config Type

- [x] 1.1 Add `workflow_instructions?: string` to `WorkflowTemplateConfig` in `src/bun/config/index.ts`
- [x] 1.2 Add `workflow_instructions` field to `DEFAULT_DELIVERY_YAML` string in `src/bun/config/index.ts` (commented example)

## 2. Column Config Helpers

- [x] 2.1 Add `getWorkflowTemplate(config, boardId)` to `src/bun/workflow/column-config.ts` — returns the `WorkflowTemplateConfig` for the board's assigned template, or `null`
- [x] 2.2 Add `buildSystemInstructions(config, boardId, columnId)` to `src/bun/workflow/column-config.ts` — merges `[template?.workflow_instructions, column?.stage_instructions].filter(Boolean).join("\n\n") || undefined`

## 3. Executor Updates

- [x] 3.1 Replace `column?.stage_instructions` with `buildSystemInstructions(config, task.board_id, toState)` in `src/bun/engine/execution/transition-executor.ts`
- [x] 3.2 Replace `column?.stage_instructions` with `buildSystemInstructions(config, task.board_id, task.workflow_state)` in `src/bun/engine/execution/human-turn-executor.ts` (two occurrences)
- [x] 3.3 Replace `column?.stage_instructions` with `buildSystemInstructions(config, task.board_id, task.workflow_state)` in `src/bun/engine/execution/retry-executor.ts`
- [x] 3.4 Replace `column?.stage_instructions` with `buildSystemInstructions(config, task.board_id, task.workflow_state)` in `src/bun/engine/execution/code-review-executor.ts`

## 4. Cleanup

- [x] 4.1 Delete `src/bun/workflow/slash-prompt.ts` (dead code — zero imports)
- [x] 4.2 Fix comment in `src/bun/engine/types.ts` — change "already slash-reference resolved" to reflect that `systemInstructions` is inline text, resolved only for `prompt` by each engine
- [x] 4.3 Add `workflow_instructions` field example to `config/workflows/delivery.yaml` (commented out, inline text only, no slash refs)
