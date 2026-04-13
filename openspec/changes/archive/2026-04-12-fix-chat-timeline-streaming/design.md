## Context

The Copilot engine streams events through a three-layer pipeline:

```
SDK (CopilotSdkEvent) → events.ts (EngineEvent) → orchestrator.ts (StreamEvent) → Vue store → UI
```

The `translateEvent()` function in `events.ts` converts SDK events to EngineEvents. The orchestrator's `consumeStream()` processes those events, persists messages to the DB, and relays `StreamEvent`s via IPC to the Vue store. The store maintains a tree of `StreamBlock` nodes rendered by `StreamBlockNode.vue`.

Current issues:
1. `tool.execution_partial_result` and `tool.execution_progress` are translated to `{ type: "status" }` without checking if the originating tool is internal — raw file contents flood the status bar.
2. Tool calls always get `parentBlockId = event.parentCallId ?? null` (explicit subagent only), so tools triggered after reasoning appear as root-level siblings instead of nested inside the reasoning bubble.
3. `ReadView.vue` always numbers lines from 1 regardless of the tool call's `startLine` argument.
4. Toast notifications fire for every task state change, including the active task the user is watching.

## Goals / Non-Goals

**Goals:**
- Clean, readable status bar during Copilot streaming (short summaries, not raw output)
- Visual association between reasoning and the tools it triggers
- Correct line numbers in read_file tool results
- Suppress redundant toast notifications for the active task

**Non-Goals:**
- Redesigning the streaming architecture or event protocol
- Changing how internal tools are hidden from the timeline (the existing `isInternal` filter works)
- Adding new UI components or animations
- Changing the DB persistence layer or batcher

## Decisions

### D1: Filter status events by tool internality in events.ts

**Decision**: Add `toolCallId` to `tool.execution_partial_result` and `tool.execution_progress` event data parsing, look up internally in `toolMetaByCallId`, and suppress status events for internal tools.

**Rationale**: The `toolMetaByCallId` map is already maintained in `translateCopilotStream` — it tracks every `tool.execution_start` with its `isInternal` flag. The partial_result and progress events include `toolCallId` in their data but `translateEvent()` currently ignores it. Adding the lookup is minimal code and consistent with how `tool.execution_complete` already uses the map.

**Alternative**: Filter in the orchestrator instead. Rejected because the orchestrator doesn't track internal tool state for status events — that knowledge lives in events.ts.

### D2: Truncate visible status messages to a single summary line

**Decision**: For non-internal tools, transform `partialOutput` into a short summary. Strategy:
- Take the last non-empty line only (terminal output streams bottom-up)
- Truncate to 120 characters max
- Prefix with the tool name if available from `toolMetaByCallId`

**Rationale**: The status bar is a single-line ephemeral element. Dumping multi-KB file contents into it is never useful. The last line of output is typically the most relevant (command exit status, progress indicator, etc.).

**Alternative**: Pass full content and truncate in the UI. Rejected because the IPC payload would still be unnecessarily large.

### D3: Associate tool_call blocks with preceding reasoning via callStack context

**Decision**: When the orchestrator flushes reasoning before a tool_call, instead of persisting the reasoning block immediately, keep it as an "open context" block. Set `parentBlockId` on the tool_call's `StreamEvent` to the reasoning block's ID when tools fire right after reasoning.

Implementation approach:
- Track a `reasoningBlockId` when reasoning is flushed due to a tool_start
- Set `parentBlockId = reasoningBlockId` on the tool_call StreamEvent
- Clear `reasoningBlockId` when text tokens start (the reasoning phase is over)

**Rationale**: The tool_call's explicit `parentCallId` is for subagent nesting (correct — don't change). But we need a *separate* concept: "visual grouping context." The reasoning block is the natural parent because models emit reasoning → tools → text in sequence.

**Alternative**: Group in the UI by timestamp proximity. Rejected because it's fragile and the orchestrator already has the ordering information.

### D4: Pass line offset to ReadView via prop

**Decision**: In `ToolCallGroup.vue`, extract `startLine` from the parsed tool call arguments and pass it to `ReadView` as a new `:startLine` prop. `ReadView` uses `startLine + windowStart + i` in the gutter instead of `windowStart + i + 1`.

**Rationale**: The tool call content already contains the arguments as JSON. Parsing `startLine` is trivial. The change is localized to two components.

### D5: Suppress toast for active task in App.vue

**Decision**: Add a guard in `toastForActivity()`: skip the toast when `activity.task.id === taskStore.activeTaskId`.

**Rationale**: The user is already looking at the task — state changes are visible in the execution badge, spinner, and stream blocks. The toast is redundant and distracting. The unread badge logic already makes this distinction.

## Risks / Trade-offs

- **[Reasoning-tool grouping may shift existing tests]** → The UI test suite (`chat-timeline-pipeline.test.ts`) validates block ordering. Tests will need updating to expect tool_calls nested under reasoning blocks instead of at root level. Mitigation: update tests as part of the implementation task.

- **[Status filtering may hide useful progress for long tools]** → Internal tool filtering could suppress genuinely useful "reading file X" feedback. Mitigation: Decision D2 emits a short summary for *visible* tools; for internal tools, we emit nothing (they're invisible by design). If users report the UI feeling frozen, a follow-up can add lightweight "Working..." indicators.

- **[Single-line status truncation loses detail]** → Power users might want full terminal output during streaming. Mitigation: The full output is still visible in the tool result when the tool completes. Status is only a transient progress indicator.
