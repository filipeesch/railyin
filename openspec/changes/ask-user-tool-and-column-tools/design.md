## Context

The engine currently uses a single global `TOOL_DEFINITIONS` array. Every execution gets the same tools if a worktree is available, or no tools if not. There is no way to configure this per-column. When the model needs to ask the user something it has no mechanism other than prose text (which breaks the chat flow) or misusing unrelated tools.

The `waiting_user` execution state is already typed in `rpc-types.ts` and partially referenced in the drawer UI, but nothing in the engine ever sets it. This change wires it up end-to-end.

## Goals / Non-Goals

**Goals:**
- Add `ask_user` as a proper tool the model can call with a structured question + options
- Engine intercepts `ask_user` before executing it — saves state, sets `waiting_user`, suspends
- Chat renders a widget (radio/checkbox + Other text) instead of a plain bubble
- Per-column `tools:` array in YAML controls which tools the model sees
- `waiting_user` → `running` resume is handled via the existing `handleHumanTurn` path

**Non-Goals:**
- Multi-step questionnaires (one `ask_user` call per suspension, then the loop resumes normally)
- Persisting `liveMessages` in-memory context across the suspension (the full conversation history is sufficient for resumption)
- Branching or conditional logic based on user answers (the model handles that)

## Decisions

### D1: Engine intercepts `ask_user` as a special case in the tool loop

**Decision:** In the tool execution loop, check if any call is `ask_user` before dispatching to `executeTool`. If found, save the question/options as a new `ask_user_prompt` conversation message, set `execution_state = 'waiting_user'`, and return early (do not continue the loop).

**Alternatives considered:**
- Execute `ask_user` like a normal tool and return a sentinel result → model would continue the loop immediately with the "result" instead of waiting. Rejected.
- Add a separate pre-loop pass to detect `ask_user` → same complexity, less readable.

### D2: Resume via `handleHumanTurn` (fresh context, not resumed liveMessages)

**Decision:** When the user submits their answer, `handleHumanTurn` is called as normal. The model receives the full conversation history (which includes the `ask_user_prompt` message and the user's answer), giving it the context to continue. No in-memory state is preserved between the two executions.

**Alternatives considered:**
- Persist `liveMessages` to the DB and reload on resume → significant complexity, the conversation history already carries everything the model needs. Rejected.

### D3: `ask_user_prompt` as a dedicated conversation message type

**Decision:** Add `ask_user_prompt` to the message type enum. The message content is JSON: `{ question, selection_mode, options }`. The frontend pattern-matches on this type to render the widget instead of a text bubble. After the user answers, their selection is appended as a normal `user` message.

**Alternatives considered:**
- Reuse `tool_call` message type and let the frontend inspect the function name → would require frontend to parse tool call JSON to decide rendering. Tightly coupled. Rejected.

### D4: Per-column `tools` array with fallback to current defaults

**Decision:** `WorkflowColumnConfig` gains an optional `tools?: string[]` field. When present, the engine filters `TOOL_DEFINITIONS` to only those named in the array. When absent, the engine falls back to the current behavior (all tools if worktree exists). This is backward-compatible — existing configs without `tools:` continue working unchanged.

**Alternatives considered:**
- Opt-out model (list tools to exclude) → harder to reason about, "what's available?" requires reading defaults + exclusions. Rejected.
- Separate `enabled_tools` + `disabled_tools` arrays → over-engineered for current needs. Rejected.

### D5: Frontend always appends "Other" option

**Decision:** The chat widget always renders an "Other (specify)" option after the model's options, with a text input that becomes active when "Other" is selected. The user's answer — whether a model-provided option or a free-text "Other" — is submitted as a plain user message string.

**Alternatives considered:**
- Model declares whether "Other" is allowed → adds schema complexity. "Other" should always be available since the user is always free to redirect. Rejected.

## Risks / Trade-offs

- **Model doesn't use `ask_user` consistently** → Models may still ask questions in prose. Per-column opt-in mitigates this (columns that need it can include `ask_user` in their tool list and mention it in `stage_instructions`).
- **`ask_user` called multiple times before suspension** → The engine will intercept the first `ask_user` call and return early. Subsequent calls in the same turn are dropped. Low risk — models rarely issue multiple `ask_user`s at once.
- **Widget state after reload** → If the drawer is closed and reopened while in `waiting_user`, the `ask_user_prompt` message must still render the widget correctly from DB. This is handled by the dedicated message type being persisted in DB.

## Migration Plan

No DB migrations required — `ask_user_prompt` is a new message `type` value stored in the existing `conversation_messages.type` text column. Existing rows are unaffected.

YAML config is additive — no existing workflow YAML breaks from the added optional `tools:` field.
