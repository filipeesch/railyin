## Context

The Railyin app supports three execution engines: NativeEngine (LM Studio / local providers), ClaudeEngine (Anthropic Claude via claude-agent-sdk CLI), and CopilotEngine (GitHub Copilot via @github/copilot-sdk). All three can hit context window limits during long tasks.

Today, only the NativeEngine path has compaction logic — wired into `workflow/engine.ts` via `handleHumanTurn()`. The Claude and Copilot engines go through `orchestrator._runNonNative()` → `consumeStream()`, which has zero compaction awareness.

Both SDKs already handle compaction internally:
- **Copilot SDK**: emits `session.compaction_start` / `session.compaction_complete` events with token metrics; exposes `session.compaction.compact()` for manual trigger
- **Claude SDK**: provides an `onCompactProgress` callback in `sdk.query()` options with `compact_start` / `compact_end` events; auto-compaction happens internally on overflow

The UI already has:
- A context ring SVG gauge (updates after each execution)
- A `compaction_summary` MessageBubble renderer (divider with collapsible summary)
- A `McpToolsPopover.vue` pattern (Popover triggered by a toolbar icon button)

## Goals / Non-Goals

**Goals:**
- Surface auto-compaction events from both Claude and Copilot engines to the UI in real-time
- Provide a richer context window popover (linear gauge, token counts, manual compact)
- Add `compact()` to the engine interface for engines that support explicit compaction
- Keep everything above the engine layer (orchestrator, UI) engine-agnostic

**Non-Goals:**
- Compaction for NativeEngine is not changed (already works via handleHumanTurn)
- No summary content displayed to the user — divider only
- No changes to how compaction works inside the SDKs
- No changes to the compaction prompt or `compactConversation()` logic

## Decisions

### Decision 1: Abstract `compaction_start` / `compaction_done` engine events

Rather than having `consumeStream()` understand Copilot vs Claude events, each engine emits two new abstract events. The orchestrator handles them uniformly.

**Alternatives considered:**
- Engine-specific handling in orchestrator — rejected: breaks the engine abstraction, requires engine type checks
- Single `compaction` event with a phase field — rejected: harder to track in-flight state in orchestrator

### Decision 2: `compact?()` as optional method on `ExecutionEngine`

Copilot implements it via `session.compaction.compact()`. Claude does not implement it (auto-only). If an engine omits `compact()`, the UI hides the button — no fallback to Railyin's own `compactConversation()`.

**Alternatives considered:**
- Always fall back to Railyin's `compactConversation()` — rejected: for Claude/Copilot the DB-level compaction doesn't sync SDK session state
- Expose via a separate capability interface — rejected: unnecessary complexity; optional method is idiomatic TypeScript

### Decision 3: `supportsManualCompact?: boolean` on `ProviderModelList.models`

Follows the same pattern as `supportsAdaptiveThinking` already in the codebase. Each engine sets this in `listModels()`. The UI reads it from the model store to conditionally render the Compact button.

**Alternatives considered:**
- Field on `Task` — rejected: it's an engine/model capability, not task state
- Field on `contextUsage` response — rejected: overloads a metrics response with a capability flag
- Runtime capability check via `engine.compact !== undefined` — rejected: not accessible from the frontend without an RPC

### Decision 4: Claude uses `onCompactProgress` callback, not stream events

The `onCompactProgress` hook is passed in the `sdk.query()` options (same bag as `hooks`, `canUseTool`, etc.) and fires `compact_start` / `compact_end` synchronously during streaming. The existing `system.subtype === "compaction_summary"` stream event serves as a post-hoc fallback for `compaction_done` in case the hook is unavailable.

**Alternatives considered:**
- Only use the stream event — rejected: no `compaction_start` signal available from stream events alone
- MCP tool-based hook — rejected: hooks are the correct extension point for this

### Decision 5: Divider only — no summary content in UI

The compaction_summary message is written with empty content. The MessageBubble renderer shows only the "— Conversation compacted —" divider. No summary, no `<details>` toggle.

**Rationale:** Summary content is generated for the *model*, not the user. Displaying it creates noise and false expectations about what the model actually receives.

### Decision 6: Context ring becomes popover trigger

Pattern follows `McpToolsPopover.vue` — a `<Button>` with icon triggers a `<Popover ref>`. The ring SVG is wrapped in a button. Popover contains: model name, linear ProgressBar (PrimeVue), token counts, and conditional Compact button at the bottom.

## Architecture

```
Engine layer:
  CopilotEngine._run()
    SDK session event: session.compaction_start
      → emit { type: "compaction_start" }
    SDK session event: session.compaction_complete
      → emit { type: "compaction_done" }
    compact(): session.compaction.compact()

  ClaudeEngine (via adapter._run())
    onCompactProgress({ type: "compact_start" })
      → emit { type: "compaction_start" }
    onCompactProgress({ type: "compact_end" })
      → emit { type: "compaction_done" }
    fallback: translateClaudeMessage(system.subtype="compaction_summary")
      → emit { type: "compaction_done" }
    compact(): not implemented → button hidden

Orchestrator layer:
  consumeStream() event handler:
    "compaction_start"
      → appendMessage(taskId, "system", "Compacting conversation…")
      → onNewMessage(...)
    "compaction_done"
      → appendMessage(taskId, "compaction_summary", "")
      → onNewMessage(...)
      → fetchContextUsage()   ← triggers ring update

RPC layer:
  tasks.compact(taskId)
    → orchestrator.compactTask(taskId)
    → engine.compact(taskId)

UI layer:
  Toolbar: [ring-button] → ContextPopover
  ContextPopover:
    model name
    linear gauge (fraction, color-coded)
    token counts (~used / max)
    [Compact] button (hidden if !supportsManualCompact)

  MessageBubble: compaction_summary → divider only
```

## Risks / Trade-offs

- **Copilot `compact()` is `@experimental`** → It may be removed or change signature. Mitigation: wrap in try/catch; log failure without crashing; accept that the button disappears gracefully if the API changes.
- **Claude `onCompactProgress` is undocumented** → Discovered by reading the compiled CLI binary. It may change between CLI versions. Mitigation: wrap in a try/catch option inject; fall back gracefully to the stream-event path.
- **Context ring update is async** → After `compaction_done`, `fetchContextUsage()` fires an RPC. The ring may show stale data for ~100ms. This is acceptable — no spinner needed.
- **Dual `compaction_done` signals for Claude** → If both `onCompactProgress` and `system.subtype=compaction_summary` fire, two `compaction_done` events reach `consumeStream()`. Mitigation: orchestrator tracks an `inCompaction` flag per execution; second `compaction_done` is silently dropped if not `inCompaction`.

## Migration Plan

1. Backend changes (engine events, orchestrator, RPC) are fully backward-compatible — no DB migrations needed
2. `compaction_summary` messages written by the new path have empty content — existing messages with content still render as dividers (no summary content ever shown anyway in new renderer)
3. `supportsManualCompact` is an optional field — existing model list consumers ignore unknown fields

## Open Questions

- None — all design decisions have been resolved during exploration.
