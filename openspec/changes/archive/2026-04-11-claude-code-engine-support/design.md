## Context

Railyin already routes task execution through an `ExecutionEngine` abstraction and a shared orchestrator. That makes a Claude backend feasible, but the current non-native contract is still biased toward "fire an execution, stream events, then stop." Claude's Agent SDK behaves more like Claude Code itself: it can pause inside the running agent loop for permission requests and `AskUserQuestion`, then continue the same session after the application returns an answer.

We also want the Claude backend to feel like Claude Code rather than a generic Claude API wrapper. That means using the Agent SDK's Claude Code presets and project setting sources so `CLAUDE.md`, skills, and slash commands are loaded natively by the SDK rather than rebuilt in Railyin.

## Goals / Non-Goals

**Goals:**
- Add a third engine type, `claude`, behind the existing engine abstraction.
- Preserve the engine-agnostic layer above the engine implementation: task RPC handlers, UI, and orchestrator-facing persistence rules stay shared.
- Make non-native interactive pauses resumable so Claude can surface permissions and questions as part of a live execution.
- Let Claude keep owning its built-in tools and project features while Railyin exposes only its engine-agnostic task-management tools.
- Reuse the shared backend scenario harness for Claude-specific tests with deterministic SDK mocks.

**Non-Goals:**
- Replacing the native engine or reducing its existing feature set.
- Reworking Copilot's approval flow in this change.
- Recreating Claude Code features in app code when the SDK can provide them.
- Supporting multiple active engines per workspace.

## Decisions

### 1. Add `engine.type: claude` as a minimal non-native engine config

The workspace engine config gains a third type:

```yaml
engine:
  type: claude
  model: claude-sonnet-4-6 # optional
```

No provider list, API key, or base URL is stored in `workspace.yaml` for the Claude engine. Authentication and executable handling stay within the Claude Agent SDK and the user's Claude Code environment.

Rationale:
- Matches the existing non-native engine philosophy used by Copilot.
- Keeps secrets and SDK-specific auth chains out of workspace config.

### 2. Treat Claude as a peer to Copilot, not as an extension of the native engine

`ClaudeEngine` lives beside `CopilotEngine` under `src/bun/engine/claude/`. It implements the same `ExecutionEngine` contract, and the orchestrator continues to own persistence, task state updates, and RPC relay.

Rationale:
- Keeps everything above `ExecutionEngine` technology-agnostic.
- Avoids contaminating native-engine code with Claude-specific session and callback behavior.

### 3. Use Claude Code presets and project setting sources by default

The Claude engine uses the Agent SDK in Claude Code mode:
- Claude Code system prompt preset
- Claude Code built-in tool preset
- `settingSources: ["project"]`

This allows the SDK to load project-local Claude Code assets such as `CLAUDE.md`, skills, and slash commands directly from the worktree. Railyin should not parse or emulate those features itself.

Rationale:
- Delivers the "works like Claude Code" experience the user expects.
- Leverages the SDK's native support instead of duplicating Claude Code behavior in Railyin.

Trade-off:
- The first version should target project-level Claude Code features. If users later need user/local setting sources or explicit toggles, those can be added as follow-up config.

### 4. Expose Railyin task-management tools as Claude SDK custom tools

Claude keeps its own built-in tools for files, shell, search, editing, and agents. Railyin registers only its engine-agnostic task-management tools (`create_task`, `move_task`, `list_tasks`, etc.) through the Claude SDK's custom tool surface.

Rationale:
- Preserves the clean "Claude Code plus Railyin task tools" model.
- Avoids duplicate file/shell/search tools competing with Claude's native capabilities.
- Reuses the existing common-tools metadata and handlers.

Alternative considered:
- Use an in-process MCP server for Railyin tools. This would also work, but custom tools are a smaller first integration step and fit the current common-tools architecture better.

### 5. Introduce a resumable non-native interaction contract

The shared engine contract needs one new concept: a non-native execution may pause for input and later continue the same execution. To support that, the engine layer gains a resume path for waiting executions, carrying either:
- a user answer to a Claude `AskUserQuestion` prompt, or
- a permission decision for a shell/tool approval request.

The orchestrator remains responsible for:
- persisting `ask_user_prompt` conversation messages,
- updating `task.execution_state` to `waiting_user`,
- keeping the execution associated with the task as resumable,
- routing the eventual answer/approval back into the engine resume path.

Rationale:
- Claude's SDK pauses inside a live query when `canUseTool` asks for input.
- Starting a fresh execution on reply would lose the in-flight tool call context and break Claude Code semantics.

### 6. Waiting-user persistence for non-native engines becomes resumable, not terminal

When a Claude execution pauses for input:
- the task transitions to `waiting_user`,
- the execution record transitions to `waiting_user`,
- the execution remains resumable,
- the current execution ID remains associated with the task,
- terminal fields such as `finished_at` should not be finalized until the execution actually completes, fails, or is cancelled.

Rationale:
- Distinguishes a pause from a terminal stop.
- Gives the orchestrator a stable handle for resuming the same execution.

### 7. Claude sessions use deterministic per-task identity

The Claude engine should preserve context across turns by using a deterministic session identity per task, derived in a stable way that fits the SDK's session-ID constraints. The engine resumes that session on later turns for the same task/worktree and forks only when explicitly needed in future work.

Rationale:
- Matches the persistence approach already used for Copilot sessions.
- Preserves Claude's conversation context across task turns without introducing a new DB mapping layer unless required by the SDK.

### 8. Claude SDK integration should be adapter-driven and testable

Like Copilot, Claude should have an engine-specific adapter abstraction. The adapter owns:
- query creation / session resume,
- interruption and cleanup,
- model listing,
- SDK message streaming,
- permission and question callback bridging.

Tests inject deterministic Claude SDK mocks into the real `ClaudeEngine` and run the shared backend scenario suite plus Claude-specific cases.

Rationale:
- Keeps SDK-specific mechanics isolated.
- Makes the real engine testable without live Claude credentials or external processes.

## Risks / Trade-offs

- **[Interaction contract touches shared orchestrator behavior]** → Keep the new resume path generic and scoped to non-native waiting-user flows only.
- **[Claude SDK semantics may not map 1:1 to current event types]** → Translate SDK messages into the existing `EngineEvent` model where possible and extend it only when the shared contract truly needs richer data.
- **[Project setting sources may load more Claude behavior than expected]** → Start with `["project"]` only and avoid automatically loading user/local settings.
- **[Session identity constraints may require UUIDs or SDK-specific formatting]** → Use a deterministic compliant ID generator inside the adapter instead of leaking SDK rules into workspace/task models.
- **[Built-in tool overlap causes ambiguity]** → Claude owns file/shell/search/edit/agent tools; Railyin registers only task-management tools.

## Migration Plan

1. Extend the shared execution-engine/orchestrator contract for resumable non-native pauses.
2. Add `engine.type: claude` config resolution and model-selection support.
3. Implement the Claude SDK adapter and `ClaudeEngine`.
4. Register common task tools while enabling Claude Code presets and project settings.
5. Add Claude-specific backend tests and shared scenario coverage for pause/resume behavior.
6. Leave Copilot migration to the shared approval flow for the follow-up change/task.

## Open Questions

- Should the resume path live directly on `ExecutionEngine`, or on a narrower capability interface implemented only by engines that support in-loop pauses?
- Do we want an explicit workspace toggle for Claude project setting sources later, or should Claude Code mode remain always-on for this engine type?
