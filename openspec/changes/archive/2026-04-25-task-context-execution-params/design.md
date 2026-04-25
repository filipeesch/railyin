## Context

`ExecutionParams` (in `src/bun/engine/types.ts`) is the contract between the orchestrator and all execution engines. Its `systemInstructions` field was originally intended to carry column-level `stage_instructions` (behavioral guidance for the current workflow stage). Over time, orchestrator's `_buildExecutionParams` began concatenating task title/description into that field before passing it to engines — a pragmatic workaround that created a semantic ambiguity: engines receive a single string that mixes *identity context* ("what am I working on?") with *behavioral instructions* ("how should I behave?").

For the Claude engine this matters acutely. The SDK's `systemPrompt.append` places all `systemInstructions` content at the very end of the assembled system prompt — after the preset's dynamic sections (cwd, git, memory, skills) and any slash-command body injected by the model. The task block is therefore reliably the lowest-priority content the model sees, causing it to drift off-task.

## Goals / Non-Goals

**Goals:**
- Give each engine adapter typed, first-class access to task identity separately from stage instructions
- Let the Claude adapter choose the correct injection mechanism for task context without touching the orchestrator layer
- Fix the root cause without coupling the solution to any single engine's quirks
- Keep `systemInstructions` semantically clean (stage instructions only)

**Non-Goals:**
- Changing how `systemInstructions`/`stage_instructions` is assembled or used in any engine
- Changing the Copilot engine's injection strategy beyond the minimum needed to consume the new field
- Modifying any DB schema, API surface, or user-visible behaviour

## Decisions

### D1 — New typed `taskContext` field on `ExecutionParams`

Add `taskContext?: { title: string; description?: string }` as a dedicated optional field alongside `systemInstructions`.

Alternatives considered:
- *Keep using `systemInstructions` with a sentinel prefix*: Engines would parse the prefix back out — fragile string coupling.
- *Pass full `TaskRow` to the engine*: Over-exposes DB internals; engines shouldn't have domain model dependencies.

Chosen because it is the minimal typed contract: engines can be null-checked and handle it independently.

### D2 — Claude adapter injects `taskContext` via `SessionStart` hook `additionalContext`

The Claude SDK's `hooks` option accepts a `SessionStart` callback whose `SyncHookJSONOutput` supports `additionalContext: string`. This is a fully documented, non-experimental API. The SDK injects the context at session initialization, which:
- fires on both new sessions (`source: "startup"`) and resumed sessions (`source: "resume"`, `"compact"`)
- is separate from and higher-priority than `systemPrompt.append`
- does not affect prompt caching of the preset

`systemInstructions` (stage instructions) continues to flow through `systemPrompt.append` unchanged.

Alternatives considered:
- *`systemPrompt.append` only*: Current broken state — task block ends up last.
- *`excludeDynamicSections: true`*: User rejected; would lose Claude Code features.
- *Custom `systemPrompt` string*: Replaces preset entirely — loses Claude Code.
- *`criticalSystemReminder_EXPERIMENTAL`*: Experimental, avoid.
- *Inject into prompt text*: Workaround-level; breaks slash commands; re-injection logic needed.

### D3 — Copilot adapter prepends `taskContext` to `systemMessage.content`

The Copilot engine builds a `{ mode: "append", content: systemInstructions }` system message. When `taskContext` is present, it prepends the task block to `content` before the stage instructions, keeping `systemInstructions` semantically unchanged.

No session-start hook equivalent exists in the Copilot SDK, so prompt prepending is the correct strategy there.

### D4 — Orchestrator populates `taskContext` from raw task fields

`_buildExecutionParams` sets `taskContext: { title: task.title, description: task.description ?? undefined }` and removes the task-block concatenation from `systemInstructions`. The injected `fullSystemInstructions` variable is removed; `systemInstructions` is passed through as-is.

## Risks / Trade-offs

- **SessionStart hook fires once per SDK session lifecycle** — if a session is resumed mid-conversation, the `additionalContext` fires again (on `source: "resume"`). This is intentional and desirable: the model re-receives task context on resume without re-receiving it on every user turn.
- **Copilot engine prepend is on every turn** — the Copilot adapter rebuilds the system message per call. The task block will be present on all turns, not just the first. This is a minor cost (slightly larger context) but avoids history-scanning complexity in the engine.
- **`taskContext` is optional** — chat sessions (`taskId: null`) will not populate it. Engines must null-check before using it.

## Migration Plan

No DB changes, no API changes. The change is entirely internal to the engine layer. Deployment is a simple server restart. Rollback is reverting the four files.
