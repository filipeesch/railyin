## Why

The context gauge in the chat window has two independent bugs:

1. **Wrong `maxTokens` for the Copilot engine.** `tasks.contextUsage` calls `resolveModelContextWindow()` which looks for a provider with the matching prefix in `config.providers`. When the active engine is `type: copilot`, there are no providers configured — so it always falls back to the hardcoded 128,000. The correct value (e.g. 200,000 for `claude-sonnet-4.6`) is already returned by `CopilotEngine.listModels()` via `m.capabilities.limits.max_context_window_tokens`, but nothing plumbs that into the gauge. The same bug exists in `estimateContextWarning()` in `engine.ts`.

2. **Thin progress bar wastes space and is hard to read.** The current gauge is a 6 × 80px horizontal bar squeezed between the model selector and the Compact button. It conveys minimal information, contributes no readable label, and adds friction to the model row layout.

## What Changes

- **Backend — engine-agnostic context window resolution.** `tasks.contextUsage` and `estimateContextWarning()` are updated to resolve `maxTokens` by querying the orchestrator's model list first (works for any engine type: Copilot, native, OpenAI-compatible). `resolveModelContextWindow()` is used only as a fallback for models not found in the engine's list, and 128,000 is the last resort.

- **Frontend — replace bar with a 28 × 28 px SVG ring gauge.** The new component renders a circular arc fill (like a phone battery ring) with the percentage centred inside. It is colour-coded: green < 70%, yellow 70–89%, red ≥ 90%. The full `usedTokens / maxTokens` breakdown is available on hover via a tooltip. The component takes up a fixed 28 × 28 px footprint — no `flex: 1` stretching.

## Capabilities

### Modified Capabilities
- `context-gauge`: context-window resolution is now engine-agnostic; the gauge UI changes from a thin bar to a compact SVG ring with inline percentage label.

## Impact

- `src/bun/handlers/tasks.ts` — `tasks.contextUsage`: resolve `maxTokens` via orchestrator model list before falling back to `resolveModelContextWindow`
- `src/bun/workflow/engine.ts` — `estimateContextWarning()`: same fix as above
- `src/mainview/components/TaskDetailDrawer.vue` — replace `.context-gauge` bar HTML + CSS with inline SVG ring component
