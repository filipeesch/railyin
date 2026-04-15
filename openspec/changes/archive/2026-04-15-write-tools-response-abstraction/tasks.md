## 1. Contract and shared types

- [x] 1.1 Extend `EngineEvent.tool_result` in `src/bun/engine/types.ts` with optional `writtenFiles` payload
- [x] 1.2 Define/align `WrittenFile` shape with shared diff semantics (path, operation, added, removed, optional hunks/to_path/is_new)
- [x] 1.3 Ensure shared frontend/backend typing references a single canonical diff structure to avoid duplicate type definitions

## 2. Engine translation updates

- [x] 2.1 Update Copilot event translation (`src/bun/engine/copilot/events.ts`) to populate `tool_result.writtenFiles` for write tools
- [x] 2.2 Update Claude engine/adapter translation (`src/bun/engine/claude/*`) to populate `writtenFiles` when tool activity exposes file-change detail
- [x] 2.3 Update native workflow path (`src/bun/workflow/engine.ts`) to map existing write diff output into `tool_result.writtenFiles`

## 3. Orchestrator and persistence simplification

- [x] 3.1 Refactor orchestrator `tool_result` handling to consume `event.writtenFiles` instead of inferring write tools from names
- [x] 3.2 Remove orchestrator `WRITE_TOOLS` and write-tool argument parsing logic once `writtenFiles` path is wired
- [x] 3.3 Keep backward-compatible handling for legacy persisted `file_diff` records during migration window

## 4. Stream/UI unification

- [x] 4.1 Update stream-tree handling so tool call + tool result + file changes remain correlated by tool call identity
- [x] 4.2 Update `ToolCallGroup.vue` to prefer structured `writtenFiles` and fall back to legacy `file_diff` only when needed
- [x] 4.3 Update `StreamBlockNode.vue` to render real diff UX from structured payload (no placeholder-only file-changed node)

## 5. Cleanup and hardening

- [x] 5.1 Remove temporary stream diagnostic logging (`stream-diag`) from store/component paths
- [x] 5.2 Remove dead or duplicated diff inference code paths after structured payload rendering is verified
- [x] 5.3 Add regression coverage for: Copilot write tools, Claude partial/full file-change detail, and live vs persisted chat parity

## 6. Validation

- [x] 6.1 Validate mixed-history rendering (legacy `file_diff` + new structured `tool_result`) in the same timeline
- [x] 6.2 Validate changed-file counts and +/- badges remain correct for create/edit/apply_patch flows
- [x] 6.3 Validate cancellation/retry and nested tool-call scenarios preserve correct file-change association
