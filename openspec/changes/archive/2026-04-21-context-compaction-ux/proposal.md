## Why

Claude and Copilot engines handle context overflow silently — compaction happens internally with no signal to the UI. Users have no visibility into when compaction occurs, no way to trigger it manually for those engines, and the existing context ring gauge is a minimal visual with no interaction. This creates confusion and lost trust when the model's context silently resets mid-task.

## What Changes

- **New**: `compaction_start` and `compaction_done` abstract engine events emitted by Claude and Copilot engines during auto-compaction
- **New**: `compact?()` optional method on `ExecutionEngine` interface for engines that support explicit compaction triggers
- **New**: Copilot engine wires `session.compaction_start/complete` SDK events → abstract engine events, and implements `compact()` via `session.compaction.compact()`
- **New**: Claude engine wires `onCompactProgress` SDK hook → abstract engine events (`compact_start` / `compact_end`)
- **New**: `ContextPopover.vue` component — popover triggered by the context ring showing a linear gauge, token counts, and a conditional Compact button
- **Modified**: `orchestrator.consumeStream()` handles `compaction_start` and `compaction_done` events — writes system "Compacting…" message and `compaction_summary` divider to the conversation
- **Modified**: Context ring in toolbar becomes a clickable popover trigger (replacing the bare "Compact" text button)
- **Modified**: `MessageBubble.vue` `compaction_summary` render simplified — divider only, no summary content or collapsible details
- **Modified**: `ProviderModelList.models` gains `supportsManualCompact?: boolean` field; set by Copilot engine, omitted by Claude and native engines
- **New**: `tasks.compact` RPC handler

## Capabilities

### New Capabilities

- `compaction-ux`: Real-time compaction signaling to the UI — "Compacting…" spinner during compaction, "— Conversation compacted —" divider on completion, context ring update after compaction
- `manual-compact`: User-triggered compaction via ContextPopover, conditional on engine capability (`supportsManualCompact`)
- `context-popover`: Rich context window popover with linear gauge, token counts, and compact action replacing the bare Compact button

### Modified Capabilities

- `context-gauge`: Requirement changes — gauge becomes a clickable popover trigger; tooltip moves inside popover; bare Compact button removed from toolbar
- `conversation-compaction`: Requirement changes — `compaction_summary` messages no longer store or display summary content in the UI (divider only); compaction is now also triggered for Claude and Copilot engines via abstract engine events, not just the native engine path

## Impact

- `src/bun/engine/types.ts` — new EngineEvent types, new optional method on interface
- `src/bun/engine/copilot/events.ts`, `engine.ts` — SDK event translation + compact() impl
- `src/bun/engine/claude/adapter.ts`, `events.ts` — onCompactProgress wiring + fallback remap
- `src/bun/engine/orchestrator.ts` — consumeStream handles new events
- `src/shared/rpc-types.ts` — model shape extension
- `src/bun/handlers/tasks.ts` — new RPC
- `src/mainview/components/TaskDetailDrawer.vue`, `MessageBubble.vue` — UI changes
- New `src/mainview/components/ContextPopover.vue`
- `e2e/ui/extended-chat.spec.ts` — Suite R updates + new Suite S
- Unit tests: `copilot-events.test.ts`, `claude-events.test.ts`, `copilot-rpc-scenarios.test.ts`
