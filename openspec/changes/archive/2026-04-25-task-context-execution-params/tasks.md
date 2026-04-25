## 1. Type Changes

- [x] 1.1 Add `taskContext?: { title: string; description?: string }` field to `ExecutionParams` in `src/bun/engine/types.ts`
- [x] 1.2 Add `taskContext?: { title: string; description?: string }` field to `ClaudeRunConfig` in `src/bun/engine/claude/adapter.ts`

## 2. Orchestrator

- [x] 2.1 In `orchestrator.ts` `_buildExecutionParams`: populate `taskContext` from `task.title` / `task.description` when `taskId` is non-null
- [x] 2.2 In `orchestrator.ts` `_buildExecutionParams`: remove the task block concatenation from `systemInstructions` (remove `taskContext` local array and `fullSystemInstructions` composition; pass `stage_instructions` as-is)

## 3. Claude Adapter

- [x] 3.1 In `adapter.ts`: when `config.taskContext` is present, register a `SessionStart` hook that returns `additionalContext` with the formatted `## Task` block (title + optional description)
- [ ] 3.2 In `adapter.ts`: remove any diagnostic logging added during investigation (uncommitted lines in the outbound payload section)

## 4. Copilot Engine

- [x] 4.1 In `copilot/engine.ts`: when `params.taskContext` is present, prepend the formatted task block to `systemMessage.content` ahead of `systemInstructions`

## 5. Verification

- [ ] 5.1 Start a task execution with the Claude engine and confirm the model responds with awareness of the task title/description
- [ ] 5.2 Confirm a chat session (no taskId) continues to work without a task block being injected
