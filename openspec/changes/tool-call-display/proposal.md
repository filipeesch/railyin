## Why

Tool call headers in the conversation UI are assembled by `ToolCallGroup.vue` using hardcoded argument key names (`args.path`, `args.pattern`, `args.command`…) and tool name string checks (`toolName === 'read_file'`). This knowledge belongs in the engine layer — each engine owns its tool vocabulary, and the UI should not need to know it.

## What Changes

- Add a `ToolCallDisplay` structured type to the engine contract (`EngineEvent.tool_start`)
- Add `buildCommonToolDisplay()` to `common-tools.ts` for the shared task-management tools (used by both Claude and Copilot engines)
- Add `buildClaudeBuiltinDisplay()` to `claude/events.ts` for Claude Code's native tools (Bash, Read, Write, Glob, Grep, etc.)
- Add `buildCopilotNativeDisplay()` to `copilot/events.ts` for Copilot's native tools (read_file, create, edit, apply_patch, run_in_terminal, etc.)
- Thread `display` through `orchestrator.ts` into the stored `tool_call` JSON payload (pass-through only, no logic)
- Update `ToolCallGroup.vue` to consume `display.label`, `display.subject`, `display.contentType`, and `display.startLine` — removing all hardcoded arg key names and tool name string checks
- **BREAKING** (internal): Remove the dead `emit` parameter and dead `tool_start`/`tool_result` emit calls from `claude/tools.ts` (these run in a subprocess and never reach the main process)
- Remove duplicate `import` lines in `copilot/tools.ts`

## Capabilities

### New Capabilities

- `tool-call-display`: Structured display metadata (`label`, `subject`, `contentType`, `startLine`) emitted by each engine at the `tool_start` event boundary, driving how tool calls are rendered in the conversation timeline

### Modified Capabilities

- `engine-common-tools`: Adds `buildCommonToolDisplay()` — a pure display function alongside the existing tool definitions and handler
- `claude-engine`: `translateClaudeMessage()` now derives and attaches display metadata for every tool_use block; dead emit code removed from `tools.ts`
- `copilot-engine`: `translateEvent()` now derives and attaches display metadata; duplicate imports removed from `tools.ts`
- `execution-engine`: `tool_start` EngineEvent gains optional `display` field; `orchestrator.ts` passes it through to stored message JSON

## Impact

- `src/bun/engine/types.ts` — new `ToolCallDisplay` type; `tool_start` gains `display?`
- `src/bun/engine/common-tools.ts` — new `buildCommonToolDisplay()` export
- `src/bun/engine/claude/events.ts` — new `buildClaudeBuiltinDisplay()`; attached in `translateClaudeMessage`
- `src/bun/engine/claude/tools.ts` — dead emit code removed; `EngineEvent` import removed
- `src/bun/engine/copilot/events.ts` — new `buildCopilotNativeDisplay()`; attached in `translateEvent`
- `src/bun/engine/copilot/tools.ts` — duplicate imports removed
- `src/bun/engine/orchestrator.ts` — pass `display` through the stored tool_call JSON (single line change)
- `src/mainview/components/ToolCallGroup.vue` — `primaryArg`, `readFileStartLine` heuristics replaced; `toolName === 'read_file'` checks replaced with `display.contentType`
- No DB schema changes; no API surface changes; no breaking changes for consumers outside the engine boundary
