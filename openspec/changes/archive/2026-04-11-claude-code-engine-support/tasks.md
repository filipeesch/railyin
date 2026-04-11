## 1. Shared non-native interaction contract

- [x] 1.1 Extend the execution-engine/orchestrator contract so a non-native execution can pause for input and later resume the same execution with a user answer or permission decision
- [x] 1.2 Update waiting-user persistence semantics for resumable non-native executions so the task retains the live current execution while paused
- [x] 1.3 Route task replies and approval decisions through the shared resume path when the current execution is paused for engine-provided input

## 2. Claude engine config and resolution

- [x] 2.1 Add `engine.type: claude` to config types and engine resolution
- [x] 2.2 Update workspace/config specs and validation paths so Claude engine config is treated as a minimal non-native engine block
- [x] 2.3 Update model-selection logic so Claude engine model IDs can be listed, selected, and applied per task/column

## 3. Claude SDK adapter and engine implementation

- [x] 3.1 Add `@anthropic-ai/claude-agent-sdk` to dependencies
- [x] 3.2 Create `src/bun/engine/claude/adapter.ts` (or equivalent) to wrap SDK query/session creation, resume, cleanup, permission callbacks, and model listing
- [x] 3.3 Create `src/bun/engine/claude/engine.ts` implementing `ExecutionEngine` for Claude
- [x] 3.4 Create Claude SDK message/event translation helpers that convert SDK streaming output to `EngineEvent`
- [x] 3.5 Implement deterministic per-task session identity and resume behavior for Claude executions

## 4. Claude Code feature enablement and tool registration

- [x] 4.1 Configure the Claude engine to use Claude Code presets for system prompt and built-in tools
- [x] 4.2 Enable project setting sources so `CLAUDE.md`, skills, and slash commands are loaded from the worktree
- [x] 4.3 Register Railyin common task-management tools with the Claude engine without re-registering file/shell/search/edit equivalents
- [x] 4.4 Surface Claude permission requests and `AskUserQuestion` pauses through the shared non-native interaction contract

## 5. Validation

- [x] 5.1 Add deterministic Claude SDK mock support for shared backend scenario tests
- [x] 5.2 Add Claude engine backend scenarios for streaming output, custom tool execution, question pauses, permission pauses, resume, cancellation, and model listing
- [x] 5.3 Verify that Claude engine executions preserve Claude Code project features while keeping the UI and task RPC layer engine-agnostic
