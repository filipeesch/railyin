## Why

Write-tool change visualization regressed after the chat timeline streaming refactor because file-diff behavior is split across engine-specific and orchestrator-specific paths. The current model depends on backend `WRITE_TOOLS` heuristics and ad-hoc argument parsing, which is hard to extend and will become more fragile as Claude and Copilot evolve independently.

## What Changes

- Add a structured file-change payload to `tool_result` so engines explicitly report what files changed and what changed in each file.
- Move write-tool translation complexity to each engine implementation (Copilot, Claude, native) and remove orchestrator-level write-tool name heuristics.
- Keep orchestrator responsibilities engine-agnostic: persist/relay tool results and file changes without inspecting tool names.
- Unify live-stream and persisted chat rendering so tool cards and file diff UX are consistent during execution and after completion.
- Maintain backward-compatible fallback while migrating existing `file_diff` message flow.

## Capabilities

### New Capabilities
- `tool-result-file-changes`: structured `tool_result` file-change contract (`writtenFiles`) consumable by all engines and chat UI.

### Modified Capabilities
- `execution-engine`: `EngineEvent.tool_result` shape gains structured file-change metadata.
- `copilot-engine`: translates Copilot write-tool events into structured `writtenFiles` payload.
- `claude-engine`: translates Claude tool activity into structured `writtenFiles` payload where available.
- `file-diff-visualization`: renders structured file-change payload consistently in live and persisted timelines.
- `unified-ai-stream`: stream block tree carries tool result + file-change data with stable parent linkage.

## Impact

- Affected backend: `src/bun/engine/types.ts`, `src/bun/engine/orchestrator.ts`, `src/bun/engine/copilot/events.ts`, `src/bun/engine/claude/*`, `src/bun/workflow/engine.ts`.
- Affected frontend: `src/mainview/components/ToolCallGroup.vue`, `src/mainview/components/StreamBlockNode.vue`, `src/mainview/stores/task.ts`, and pairing utilities.
- Affected shared contracts: `src/shared/rpc-types.ts` and stream event transport assumptions.
- Migration concern: existing historical conversations that only contain legacy `file_diff` messages must remain viewable.
