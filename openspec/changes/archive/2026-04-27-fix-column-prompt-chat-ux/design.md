## Context

Column-entry automation currently appears in task chat as two loosely related timeline items: a `transition_event` with minimal `from`/`to` metadata and a separate `user(role=prompt)` message containing raw `on_enter_prompt` text. This creates three problems:

1. The user-visible story is backwards: the workflow transition is visually secondary while internal orchestration text dominates the timeline.
2. The chat history leaks authored workflow prompt text instead of centering the execution context that actually matters to the user.
3. The frontend must infer entered-column UX by reading neighboring generic messages instead of rendering a first-class domain object.

The code already has the right seams to improve this: `transition_event` supports metadata, `conversation_messages.metadata` can store structured JSON, and the task chat already has chip parsing utilities for rendering prompt-like text inline. The change is cross-cutting because it affects transition persistence, shared RPC typing, and task detail timeline rendering.

## Goals / Non-Goals

**Goals:**
- Make entered-column automation read as a structured workflow event in chat.
- Preserve exact workflow wording (`Moved to X from Y`) while making it visually primary.
- Show entered-column instructions only on demand via a collapsed disclosure.
- Ensure the disclosure body renders with the same chip language used in normal chat content.
- Keep raw source information available in metadata without surfacing it in the default UI.
- Reduce coupling between transition rendering and generic user-prompt rendering.

**Non-Goals:**
- Redesign human-authored chat messages or slash-command UX outside column-entry events.
- Change workflow YAML authoring syntax or remove `on_enter_prompt`.
- Rework testing strategy in this change beyond capturing the implementation work required.
- Introduce a broad new message type if the existing `transition_event` can carry the required semantics cleanly.

## Decisions

### 1. `transition_event` becomes the sole user-visible artifact for column-entry automation

**Decision:** A prompted column entry will still append a `transition_event`, but it will now own the UI story for the transition and any entered-column instruction details. The orchestrator will stop relying on a neighboring `user(role=prompt)` message as the main historical representation for column-entry automation.

**Why:** The transition is the domain event the user cares about. Treating the entered prompt as a generic user message leaks orchestration mechanics into the main timeline and forces the UI to reconstruct meaning from two independent rows.

**Alternatives considered:**
- **Keep two rows and restyle them:** rejected because it preserves split ownership and timeline noise.
- **Introduce a brand-new message type for transition cards:** rejected for now because `transition_event` already exists and supports metadata.

### 2. Transition metadata will carry structured instruction details

**Decision:** `transition_event.metadata` will be extended to include a structured payload for entered-column automation, including `from`, `to`, whether the destination column has automation, and an `instructionDetail` object with the prompt text to display plus hidden source metadata.

Proposed shape:

```ts
type TransitionEventMetadata = {
  from: string | null;
  to: string;
  instructionDetail?: {
    displayText: string;
    sourceText: string;
    sourceKind: "inline" | "slash";
    sourceRef?: string;
  };
};
```

**Why:** This keeps the transition card self-sufficient and removes the need for message-neighbor heuristics.

**Alternatives considered:**
- **Store executed prompt text in message content:** rejected because content is already semantically the transition row itself.
- **Make the frontend resolve prompt details at render time:** rejected because the conversation history should be stable and not depend on current filesystem state.

### 3. Displayed instruction text will preserve authored slash references in entered-column UX

**Decision:** The transition disclosure will preserve authored slash references when the source prompt is slash-based, so the visible chat history keeps the same slash-chip language as normal prompt content. Resolved/effective prompt text remains available in metadata for execution parity and debugging.

**Why:** The user-visible card should stay consistent with the rest of chat when slash prompts are involved. Showing the fully resolved prompt body in the disclosure leaks internal expansion details and loses the slash reference UX that was explicitly chosen.

**Alternatives considered:**
- **Show effective prompt text by default:** rejected because it hides the authored slash reference and breaks the chosen chip-style UX.
- **Show both raw and effective text by default:** rejected because it recreates clutter and pushes internal detail back into the main flow.

### 4. Transition instruction rendering will reuse chip segmentation, not bespoke code formatting

**Decision:** The expanded instruction body will use the same inline-chip rendering language already used for normal user messages wherever possible. If the prompt text contains slash-style, file, or tool references, they should render as chips rather than a monolithic `<code>` block.

**Why:** The user explicitly wants the same visual language as normal prompt/chat content, and the repo already has `segmentChipText()` for this behavior.

**Alternatives considered:**
- **Render instructions as `<code>` only:** rejected because it looks internal and inconsistent with the rest of chat.
- **Render full markdown:** rejected as the default because entered-column instructions are more often prompt-like command text than long prose.

### 5. UI responsibilities will be split into dedicated transition-card pieces

**Decision:** The task chat will gain a dedicated transition card path instead of growing `MessageBubble.vue` into a larger special-case switch. The implementation should extract or add a small component hierarchy such as `TransitionEventCard` plus a shared rich-text/prompt segment renderer.

**Why:** This follows SOLID and reduces the risk of `MessageBubble.vue` becoming a god component that owns all specialized timeline semantics.

**Alternatives considered:**
- **Keep everything inside `MessageBubble.vue`:** rejected because the transition card has enough distinct behavior (summary, disclosure, rich instruction rendering) to deserve its own component.

## Risks / Trade-offs

- **[Prompt parity risk]** Engine-owned prompt resolution is not uniformly exposed today. → **Mitigation:** define the transition detail as the prompt text prepared for entered-column execution, using shared resolver logic where available and preserving hidden raw source metadata for debug parity.
- **[History migration risk]** Older conversations will have the legacy two-row shape. → **Mitigation:** keep backward-compatible rendering for existing prompt rows; only new transitions need the card metadata.
- **[Component sprawl risk]** Adding a card component could duplicate chip-rendering logic. → **Mitigation:** extract a small shared renderer/helper for prompt-like segments rather than copying logic.
- **[Spec overlap risk]** Prompt persistence semantics touch both workflow and conversation capabilities. → **Mitigation:** keep workflow-engine focused on execution/persistence and task-detail focused on rendering, with conversation defining the timeline contract.

## Migration Plan

1. Extend the shared transition metadata contract in the conversation types.
2. Update transition execution persistence so prompted column entry writes enriched transition metadata and no longer depends on a separate visible prompt row for new history.
3. Add dedicated task-detail rendering for structured transition cards with collapsed instructions.
4. Preserve legacy rendering for old conversations that still contain standalone prompt messages.
5. Rollback path: revert to the current `transition_event` + prompt-row persistence and generic message rendering if regressions appear.

## Open Questions

- None for proposal readiness. The remaining work is implementation detail and backward-compatibility handling, not product direction.
