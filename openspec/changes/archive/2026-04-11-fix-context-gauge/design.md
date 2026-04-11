## Context

The context gauge shows how much of a model's context window the current conversation occupies. It consists of two parts: a backend RPC (`tasks.contextUsage`) that computes `{ usedTokens, maxTokens, fraction }`, and a frontend component that visualises the result.

Two problems exist today:

1. `maxTokens` is wrong for the Copilot engine — `resolveModelContextWindow()` can only look up context window sizes for providers configured in `config.providers`, but `CopilotEngineConfig` has no providers array. The same issue is present in `estimateContextWarning()`.

2. The frontend gauge is a 6 × 80px bar — no readable label, poor space efficiency.

## Goals / Non-Goals

**Goals:**
- Resolve `maxTokens` correctly for all engine types (Copilot, native, OpenAI-compatible)
- Replace the thin bar with a compact 28px SVG ring gauge showing percentage inline
- Keep the existing RPC shape `{ usedTokens, maxTokens, fraction }` — no frontend data model changes
- Keep colour-coded states: green < 70%, yellow 70–89%, red ≥ 90%

**Non-Goals:**
- Changing how `usedTokens` is estimated (that's tracked separately in `usage-token-tracking`)
- Adding a per-model context window display anywhere else in the UI

## Decisions

### D1: Resolve `maxTokens` via `orchestrator.listModels()` first

`orchestrator.listModels(workspaceId)` delegates to the active engine's `listModels()` implementation. For the Copilot engine this returns models with `contextWindow` set from `m.capabilities.limits.max_context_window_tokens`. For native engines, each model also carries a `contextWindow` from the provider's model API or config override.

Resolution order in both `tasks.contextUsage` and `estimateContextWarning()`:
1. Call `orchestrator.listModels(workspaceId)` — find the task's model by `qualifiedId`
2. If found and `contextWindow` is non-null → use it
3. Otherwise fall back to `resolveModelContextWindow(taskModel)` (covers native providers not yet in the engine list)
4. Final fallback: `128_000`

This requires the orchestrator to be accessible inside both call sites. `tasks.contextUsage` already calls `orchestrator.listModels()` indirectly (via `models.listProviders`), so the orchestrator reference is available in `handlers/tasks.ts`. `estimateContextWarning()` in `engine.ts` currently uses only `getConfig()` — it gains an optional `orchestrator` parameter (defaulting to a local fallback) or is called with the resolved value from the caller.

Simpler option: extract a shared `resolveContextWindow(taskModel, workspaceId)` helper in `handlers/tasks.ts` that does the 4-step resolution and call it from both locations.

### D2: SVG ring gauge — pure inline SVG, no new dependencies

```
Geometry:
  SVG size:       28 × 28 px
  Circle centre:  cx=14, cy=14
  Radius:         10
  Stroke width:   3
  Circumference:  2π × 10 ≈ 62.83

Fill animation:
  stroke-dasharray  = "62.83"
  stroke-dashoffset = 62.83 × (1 − fraction)
  rotate(-90, 14, 14) so arc starts at top (12 o'clock)
  stroke-linecap: round

Label:
  <text> centred at (14, 18), font-size 7px
  Shows "N%" where N = Math.round(fraction × 100)
  Hidden (display: none) when fraction is 0

Colour logic (same thresholds as current bar):
  fraction < 0.70  → var(--p-green-500,  #22c55e)
  fraction < 0.90  → var(--p-yellow-500, #eab308)
  fraction ≥ 0.90  → var(--p-red-500,   #ef4444)

Track colour:
  light: var(--p-surface-200, #e2e8f0)
  dark:  var(--p-surface-700, #334155)
```

The ring replaces the existing `.context-gauge` / `.context-gauge__bar` markup and CSS. The `title` tooltip stays the same: `"~{usedTokens} / {maxTokens} tokens ({pct}%)"`.

### D3: No change to the RPC interface

`tasks.contextUsage` continues to return `{ usedTokens: number; maxTokens: number; fraction: number }`. Only the `maxTokens` value becomes correct.

## Risks / Trade-offs

- **`orchestrator.listModels()` latency**: for the Copilot engine, `listModels()` makes a network call. The fix should cache the result (or reuse the cached model list already fetched for the model selector) to avoid per-request latency. The simplest approach: catch errors and fall through to `resolveModelContextWindow` if `listModels` throws.
- **SVG font rendering**: the 7px label text may render slightly differently across OS font stacks. Using `font-family: system-ui` and `dominant-baseline: auto` with explicit `dy` offset is safer than relying on `alignment-baseline`.
