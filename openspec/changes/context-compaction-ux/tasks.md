## 1. Engine Interface

- [ ] 1.1 Add `compaction_start` and `compaction_done` to `EngineEvent` union type in `src/bun/engine/types.ts`
- [ ] 1.2 Add optional `compact?(taskId: number): Promise<void>` method to `ExecutionEngine` interface in `src/bun/engine/types.ts`
- [ ] 1.3 Add `supportsManualCompact?: boolean` to `ProviderModelList.models` shape in `src/shared/rpc-types.ts`

## 2. Copilot Engine

- [ ] 2.1 Add `session.compaction_start` and `session.compaction_complete` to `CopilotSdkEvent` union in `src/bun/engine/copilot/session.ts`
- [ ] 2.2 Translate `session.compaction_start` → `{ type: "compaction_start" }` in `translateCopilotStream()` in `src/bun/engine/copilot/events.ts`
- [ ] 2.3 Translate `session.compaction_complete` → `{ type: "compaction_done" }` in `translateCopilotStream()` in `src/bun/engine/copilot/events.ts`
- [ ] 2.4 Implement `compact(taskId)` on `CopilotEngine` by calling `session.compaction.compact()` on the active session for that task in `src/bun/engine/copilot/engine.ts`
- [ ] 2.5 Set `supportsManualCompact: true` on all models returned by `CopilotEngine.listModels()` in `src/bun/engine/copilot/engine.ts`

## 3. Claude Engine

- [ ] 3.1 Add `onCompactProgress` callback to the `sdk.query()` options in `src/bun/engine/claude/adapter.ts` — emit `compaction_start` on `compact_start`, emit `compaction_done` on `compact_end`
- [ ] 3.2 In `translateClaudeMessage()` in `src/bun/engine/claude/events.ts`, remap `system.subtype === "compaction_summary"` to emit `{ type: "compaction_done" }` instead of a status string (fallback path)
- [ ] 3.3 Guard the fallback: only emit `compaction_done` from the stream event if no hook-based `compaction_done` has already been emitted in the same execution (tracked via adapter state or a flag on ClaudeRunConfig)

## 4. Orchestrator

- [ ] 4.1 Handle `compaction_start` event in `consumeStream()` in `src/bun/engine/orchestrator.ts`: append `system` message "Compacting conversation…", call `onNewMessage`, set `inCompaction = true`
- [ ] 4.2 Handle `compaction_done` event in `consumeStream()`: append `compaction_summary` message with empty content, call `onNewMessage`, reset `inCompaction = false`, trigger context usage refresh
- [ ] 4.3 Guard duplicate `compaction_done`: if `inCompaction` is false when `compaction_done` arrives, skip appending

## 5. RPC Layer

- [ ] 5.1 Add `tasks.compact` handler in `src/bun/handlers/tasks.ts` that calls `orchestrator.compactTask(taskId)` → `engine.compact(taskId)`, throwing if engine doesn't implement it
- [ ] 5.2 Add `compactTask(taskId)` method to `Orchestrator` that resolves the engine for the task's workspace and calls `engine.compact?.(taskId)`

## 6. UI — ContextPopover Component

- [ ] 6.1 Create `src/mainview/components/ContextPopover.vue` with `<Popover>` wrapper, header "Context Window", model name, PrimeVue `<ProgressBar>` with color logic (green/yellow/red), "~X,XXX / Y,XXX tokens" label
- [ ] 6.2 Add conditional "Compact conversation" `<Button>` at the bottom of ContextPopover, rendered only when `supportsManualCompact` is true for the current task's model
- [ ] 6.3 Disable the Compact button when `task.executionState === "running"`
- [ ] 6.4 Wire the Compact button to call `api("tasks.compact", { taskId })` and close the popover on success
- [ ] 6.5 Expose `toggle(event)` and `getContainer()` methods on ContextPopover (matching McpToolsPopover pattern)

## 7. UI — TaskDetailDrawer

- [ ] 7.1 Wrap the context ring SVG in a `<button>` element and bind `@click="onContextRingClick"` in `src/mainview/components/TaskDetailDrawer.vue`
- [ ] 7.2 Add `ContextPopover` ref and toggle it on ring click (matching McpToolsPopover pattern)
- [ ] 7.3 Remove the standalone `<Button label="Compact" ...>` from the toolbar
- [ ] 7.4 Remove the `compacting` ref and `compactConversation()` function (replaced by ContextPopover logic)
- [ ] 7.5 Add ContextPopover to the click-outside guard (alongside existing mcpPopoverRef check)

## 8. UI — MessageBubble

- [ ] 8.1 Simplify `compaction_summary` render in `src/mainview/components/MessageBubble.vue`: keep `.msg--compaction` divider with "— Conversation compacted —" label, remove `<details>`, `<summary>`, and `.msg--compaction__summary` prose block

## 9. Unit Tests

- [ ] 9.1 Add tests to `src/bun/test/copilot-events.test.ts`: `session.compaction_start` → `compaction_start` event; `session.compaction_complete` → `compaction_done` event (success and failure cases)
- [ ] 9.2 Add tests to `src/bun/test/claude-events.test.ts`: `system.subtype=compaction_summary` → `compaction_done` event (fallback path)
- [ ] 9.3 Add compaction scenario helpers to `src/bun/test/support/copilot-sdk-mock.ts`: `compactionStart()` and `compactionDone()` event factories
- [ ] 9.4 Add `runCompactionScenario` to `src/bun/test/support/shared-rpc-scenarios.ts`: full cycle from `compaction_start` to `compaction_done` and verify DB messages
- [ ] 9.5 Add compaction RPC scenario tests to `src/bun/test/copilot-rpc-scenarios.test.ts`: auto-compaction mid-turn writes system + compaction_summary messages; `tasks.compact` RPC calls engine compact method

## 10. E2E Tests

- [ ] 10.1 Update `R-20` in `e2e/ui/extended-chat.spec.ts`: assert context ring is visible (not the bare Compact button)
- [ ] 10.2 Update `R-20` → `R-20b`: clicking ring opens ContextPopover (`.context-popover` visible)
- [ ] 10.3 Update `R-21`: manual compact via popover button → `.msg--compaction` divider appears; assert no `.msg--compaction__details` present
- [ ] 10.4 Delete `R-22` ("Show summary" details test — feature removed)
- [ ] 10.5 Update `P-15`: assert compact button inside popover is disabled while running (open popover first, then check button state)
- [ ] 10.6 Add `R-20c`: popover shows linear gauge and token count text
- [ ] 10.7 Add `R-20d`: compact button visible when `supportsManualCompact: true` in model list
- [ ] 10.8 Add `R-20e`: compact button absent when `supportsManualCompact` omitted in model list
- [ ] 10.9 Add `S-30`: auto-compaction during turn → "Compacting conversation…" system message appears mid-stream
- [ ] 10.10 Add `S-31`: after auto-compaction → `.msg--compaction` divider appears and no `.msg--compaction__details` element exists
- [ ] 10.11 Add `S-32`: ring color is green at <70%, yellow at 70-89%, red at ≥90% (parametric test covering all three states)
- [ ] 10.12 Add `S-33`: multiple auto-compactions in one session → multiple `.msg--compaction` dividers in order
