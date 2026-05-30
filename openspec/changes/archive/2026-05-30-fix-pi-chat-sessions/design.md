## Context

`ChatExecutor` is the engine that powers standalone chat sessions. It was built as a trimmed-down sibling of `TransitionExecutor` / `HumanTurnExecutor`, but it shipped missing two constructor dependencies that task-execution contexts already carry:

1. **`ModelSettingsRepository`** — needed to resolve the per-workspace context-window override for a given model and inject `contextWindowOverride` into `ExecutionParams`.
2. **`IBoardToolExecutor`** — needed to make board management tools (`get_task`, `list_tasks`, `create_task`, `move_task`, etc.) callable from within the chat context.
3. **`onNewMessage: (msg: ConversationMessage) => void`** — needed to push the pre-flight error message to the frontend via WebSocket immediately after it is persisted to the database.

`PiEngine.buildModel()` explicitly throws when `contextWindowOverride` is `null | undefined`; this is an intentional invariant documented in the pi-engine spec. Because `ChatExecutor` never resolves and injects the value, every chat session on a Pi workspace throws immediately at model-build time. The throw propagates to `StreamProcessor.consume()`, which silently sets the session to `idle` and emits a `done` event — leaving the user with a sent message and no response.

Claude/Copilot engines don't require `contextWindowOverride` (they have fallback defaults), which is why chat works on those engines today.

## Goals / Non-Goals

**Goals:**
- Pi chat sessions produce AI responses when a context window is configured in Model Settings
- Board tools are available to Pi (and all engines) in chat contexts — consistent with task execution
- When a Pi model is selected but its context window is not configured, the user sees a clear in-conversation error instead of silent failure, pushed immediately via WebSocket
- Change is confined to `ChatExecutor` and `Orchestrator`; no interface changes to `ExecutionParams`, `IBoardToolExecutor`, or `ModelSettingsRepository`

**Non-Goals:**
- Auto-configuring a default context window (that is a Model Settings feature)
- Making `contextWindowOverride` optional in Pi's engine contract (the invariant is intentional and correct)
- Changes to Claude, Copilot, or any other engine chat behaviour
- Testing strategy (handled separately)

## Decisions

### Inject `ModelSettingsRepository` into `ChatExecutor`

Follow the exact pattern used by `TransitionExecutor` (line 161) and `HumanTurnExecutor` (line 225):
```ts
...(this.modelSettingsRepo && effectiveModel
  ? { contextWindowOverride: this.modelSettingsRepo.getContextWindow(workspaceKey, effectiveModel) ?? undefined }
  : {}),
```

**Alternative considered:** Pass `contextWindowOverride` as a method parameter from the caller (`ChatSessionHandler`). Rejected — it would push DB knowledge up the call stack and break the established pattern where executors own their param resolution.

### Inject `IBoardToolExecutor` into `ChatExecutor`

Pass `boardTools` into `ExecutionParams.boardTools` unconditionally (same as task executors). `ExecutionParams.boardTools` is already typed as optional, so executors that don't set it still work.

**Alternative considered:** Keep board tools out of chat entirely. Rejected per user decision — parity with task execution is the desired behaviour; gating by context adds inconsistency.

### Pre-flight check for missing context window (Pi engine)

Before creating the managed execution, check: if the effective engine is Pi AND `contextWindowOverride` is `undefined` after the resolution attempt, persist a system error message to the conversation, call `this.onNewMessage(errorMsg)` to push it via WebSocket, and return early. The message should be actionable (e.g. "Pi requires a context window to be configured for model '…'. Go to Model Settings to configure it.").

**Why pre-flight instead of catching the throw:** Catching the engine throw after the fact requires inspecting the error string to decide how to format the user-facing message — fragile. A pre-flight check uses a clear, typed condition (`contextWindowOverride == null`) before delegating to the engine.

**How to identify Pi engine in `ChatExecutor`:** The engine registry (`EngineRegistry`) resolves the engine instance for the workspace; `ChatExecutor` already has access to the registry. Checking the resolved engine's `engineId` (or `instanceof PiEngine`) determines whether the pre-flight applies.

**WS push via `onNewMessage`:** `ChatExecutor` is injected with `onNewMessage: (msg: ConversationMessage) => void` as a constructor parameter. After persisting the error message, `ChatExecutor` calls this callback directly — following the same pattern `HumanTurnExecutor` uses for `onTaskUpdated`. `Orchestrator` passes `this.onNewMessage` (already available for `HumanTurnExecutor`) to `ChatExecutor`.

**Alternative:** Emit the error message inside `PiEngine.buildModel()` itself. Rejected — engines don't have access to conversation-persistence or WS-push infrastructure; that would violate the engine/executor boundary.

**Alternative (WS push):** Return the error message from `executeChatTurn` and let `ChatSessionHandler` push it. Rejected — this changes the return type and pushes notification concerns up the call stack unnecessarily.

### `Orchestrator` wiring

`ChatExecutor` is constructed once in `Orchestrator.constructor()` at line 122. Add `this.modelSettingsRepo`, `this.boardTools`, and `this.onNewMessage` to that call. All three are already available on `Orchestrator` (the first two used for task executors; `onNewMessage` used for `HumanTurnExecutor`).

## Risks / Trade-offs

- **Risk: engine identity check coupling** — Checking for Pi engine inside `ChatExecutor` introduces knowledge of a concrete engine. Mitigation: use a `requiresContextWindow()` method on the engine interface, or check the resolved engine's ID against the known Pi engine ID constant rather than `instanceof`. The guard stays shallow.

- **Risk: board tools footgun** — Making board tools available in chat means a misconfigured or adversarial prompt could modify tasks from a chat session. Mitigation: this is the same risk that already exists in task execution, and it is acceptable per the user's explicit decision.

- **Trade-off: no test for silent-failure regression** — Without a test asserting that a Pi chat session with a configured context window produces a response, the regression could re-appear. This is deferred to the testing phase.

## Migration Plan

- No DB schema changes
- No RPC contract changes (no new methods or events)
- No frontend changes
- Deploy is a drop-in backend-only update; no migration steps required
- Rollback: revert the two file changes; no state to unwind

## Open Questions

_(none — all decisions resolved)_
