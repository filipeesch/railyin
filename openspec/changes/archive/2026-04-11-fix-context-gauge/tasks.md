## 1. Backend — engine-agnostic context window resolution

- [x] 1.1 In `src/bun/handlers/tasks.ts`, add a helper `resolveContextWindow(taskModel: string, workspaceId: number): Promise<number>` that resolves `maxTokens` in this order: (1) `orchestrator.listModels(workspaceId)` → find by `qualifiedId` → `contextWindow`; (2) `resolveModelContextWindow(taskModel)`; (3) `128_000`
- [x] 1.2 In `tasks.contextUsage` handler in `src/bun/handlers/tasks.ts`, replace the direct call to `resolveModelContextWindow` with the new `resolveContextWindow` helper, passing the task's `workspaceId`
- [x] 1.3 In `estimateContextWarning()` in `src/bun/workflow/engine.ts`, apply the same resolution order: try `orchestrator.listModels()` → `resolveModelContextWindow()` → `128_000`. Accept the orchestrator as a parameter or call `getOrchestrator()` if it is accessible in that module

## 2. Frontend — SVG ring gauge

- [x] 2.1 In `TaskDetailDrawer.vue`, replace the `.context-gauge` `<div>` block (lines ~309–322) with an inline SVG ring: 28×28px, `r=10`, `stroke-width=3`, `circumference≈62.83`, `stroke-dashoffset = 62.83 × (1 − fraction)`, rotated −90° so fill starts at 12 o'clock, `stroke-linecap: round`
- [x] 2.2 Add a centred `<text>` label inside the SVG showing `Math.round(fraction × 100) + '%'` at `font-size: 7`, positioned at `x=14 y=18`; hide it when `fraction === 0`
- [x] 2.3 Apply colour to the fill arc using a computed property: green (`var(--p-green-500)`) below 70%, yellow (`var(--p-yellow-500)`) at 70–89%, red (`var(--p-red-500)`) at ≥ 90%
- [x] 2.4 Keep the existing `title` tooltip on the wrapping element: `` `~${usedTokens.toLocaleString()} / ${maxTokens.toLocaleString()} tokens (${pct}%)` ``
- [x] 2.5 Remove the old `.context-gauge` and `.context-gauge__bar` CSS blocks (including the dark-mode override) and add minimal CSS for the new `.context-ring` element: `flex-shrink: 0; cursor: default`

## 3. Tests

- [x] 3.1 In the backend test suite, add a test for `resolveContextWindow`: verify it returns the value from `orchestrator.listModels()` when the model is found, falls back to `resolveModelContextWindow` when not found, and returns 128,000 when both fail
- [x] 3.2 Verify the existing `tasks.contextUsage` handler test (if present) still passes, or update it to reflect the new resolution order
