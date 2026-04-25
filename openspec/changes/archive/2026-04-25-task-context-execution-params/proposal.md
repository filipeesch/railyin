## Why

When Claude engine executes a task, the task's title and description are concatenated into `systemInstructions` (which maps to Claude SDK's `systemPrompt.append`) — placing them after all of Claude Code's preset dynamic sections (cwd, git, memory, skills). The model frequently ignores this context, causing it to drift off-task. The root cause is that two semantically distinct pieces of data — task identity (`title`/`description`) and stage behavior (`stage_instructions`) — are collapsed into a single `systemInstructions` string before the engine ever sees them, preventing each engine from handling them appropriately.

## What Changes

- Add `taskContext?: { title: string; description?: string }` as a dedicated field on `ExecutionParams`
- `orchestrator.ts` (`_buildExecutionParams`) populates `taskContext` directly from the task row and stops injecting it into `systemInstructions`
- `systemInstructions` on `ExecutionParams` reverts to carrying only `stage_instructions` (its original intent)
- `claude/adapter.ts` injects `taskContext` via the documented `SessionStart` hook `additionalContext` — a high-priority, session-scoped injection that fires on both new sessions and resumes
- `copilot/engine.ts` prepends `taskContext` to its `systemMessage.content`

## Capabilities

### New Capabilities

- `task-context-injection`: Typed `taskContext` field on `ExecutionParams`; each engine adapter owns the strategy for surfacing task identity to the model

### Modified Capabilities

- `execution-engine`: `ExecutionParams.systemInstructions` semantics narrowed — carries stage instructions only, no longer mixed with task identity data
- `claude-engine`: Task context injection strategy changes from `systemPrompt.append` to `SessionStart` hook `additionalContext`

## Impact

- `src/bun/engine/types.ts` — `ExecutionParams` interface
- `src/bun/engine/orchestrator.ts` — `_buildExecutionParams`
- `src/bun/engine/claude/adapter.ts` — `ClaudeRunConfig` + SDK query call
- `src/bun/engine/copilot/engine.ts` — system message construction
- No DB schema changes, no API changes, no breaking public contracts
