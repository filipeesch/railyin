## 1. Shared types and RPC contract

- [ ] 1.1 Change `models.list` return type in `src/shared/rpc-types.ts` from `string[]` to `{ id: string; contextWindow: number | null }[]`
- [ ] 1.2 Add `tasks.contextUsage` RPC to `rpc-types.ts`: params `{ taskId: number }`, response `{ usedTokens: number; maxTokens: number; fraction: number }`
- [ ] 1.3 Add `tasks.compact` RPC to `rpc-types.ts`: params `{ taskId: number }`, response `ConversationMessage` (the new summary message)

## 2. Config changes

- [ ] 2.1 Remove the `ai.model` required validation in `src/bun/config/index.ts` (keep the field as optional `model?: string`)
- [ ] 2.2 Update `DEFAULT_WORKSPACE_YAML` template in `config/index.ts` to comment out `model:` and note it is optional
- [ ] 2.3 Update `config/workspace.yaml` to remove the hardcoded `model:` line (or comment it out)

## 3. `models.list` handler — auto-detect context window

- [ ] 3.1 Update `models.list` handler in `src/bun/handlers/tasks.ts` to map `data[]` objects to `{ id: string, contextWindow: number | null }`, reading `context_length` from the raw object
- [ ] 3.2 Ensure the handler still returns `[]` on error without throwing

## 4. Context usage estimation

- [ ] 4.1 Add `estimateContextUsage(taskId: number, maxTokens: number): { usedTokens: number; maxTokens: number; fraction: number }` to `src/bun/workflow/engine.ts`, including a fixed overhead constant for injected system messages (~350 tokens)
- [ ] 4.2 Wire `tasks.contextUsage` RPC handler in `src/bun/handlers/tasks.ts`, resolving `maxTokens` from the task's model contextWindow (from re-fetching models.list) → config `context_window_tokens` → 128,000
- [ ] 4.3 Export `estimateContextUsage` from `engine.ts` (keep `estimateContextWarning` for backward compat or remove it after updating all callers)

## 5. Conversation compaction — backend

- [ ] 5.1 Update `compactMessages()` in `engine.ts`: find the most recent `compaction_summary` message; if found, use it as a system message + include only messages after it; if not found, existing behavior
- [ ] 5.2 Add `compactConversation(taskId: number): ConversationMessage` to `engine.ts` — fetches history, calls `turn()` with compaction system prompt, appends result as `compaction_summary` message, returns the new message
- [ ] 5.3 Add auto-compact check at the start of `handleHumanTurn()`: if `fraction >= 0.90`, call `compactConversation()` and append a system status message "Compacting conversation…" before it runs
- [ ] 5.4 Wire `tasks.compact` RPC handler in `src/bun/handlers/tasks.ts`

## 6. Frontend — model store and context usage state

- [ ] 6.1 Update `availableModels` in `src/mainview/stores/task.ts` from `ref<string[]>` to `ref<{ id: string; contextWindow: number | null }[]>`
- [ ] 6.2 Add `contextUsage` ref `{ usedTokens: number; maxTokens: number; fraction: number } | null` to task store
- [ ] 6.3 Add `fetchContextUsage(taskId)` action that calls `tasks.contextUsage` RPC and updates the ref
- [ ] 6.4 Call `fetchContextUsage` in the task store when drawer opens and after `onTaskUpdated` fires

## 7. Frontend — model selector and gauge UI

- [ ] 7.1 Update model `<Select>` in `TaskDetailDrawer.vue` to use `{ id, contextWindow }` objects — use `id` as option value and label
- [ ] 7.2 Add context gauge component inline next to the model selector: a narrow progress bar (green/yellow/red) showing `fraction * 100%`
- [ ] 7.3 Add tooltip on the gauge showing "~X,XXX / Y,XXX tokens (Z%)"
- [ ] 7.4 Hide gauge when `contextUsage` is null (unknown context window)
- [ ] 7.5 Add "Compact" button in the model row, disabled when `task.executionState === 'running'`
- [ ] 7.6 Wire Compact button to call `tasks.compact` RPC, refresh conversation messages and context usage after completion

## 8. Frontend — compaction_summary message rendering

- [ ] 8.1 Add rendering for `compaction_summary` message type in the conversation timeline (e.g. a styled divider "— Conversation compacted —" with expandable summary text)
