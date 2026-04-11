## Context

`ask_me` handles quick structured input (radio/checkbox + free text fallback). `interview_me` targets a different class of interaction: decisions that carry real architectural weight, where the user needs to read and understand implications before choosing. The model acts as an interviewer; the UI is a deliberate, form-like widget with rich markdown documentation per option.

## Goals / Non-Goals

**Goals:**
- Single tool call renders N questions, each with type, options, and rich markdown descriptions.
- Descriptions are the primary value — full markdown, fixed-height panel below the option list, content swaps on row focus without layout shift.
- Consistent gesture model across single and multi-select: row click = focus + show description; checkbox (multi) = select/deselect; both gestures are independent.
- "Other" option replaces the description panel with a textarea and hides the Notes field (they serve the same purpose).
- A persistent Notes textarea below the description panel on all questions except `freetext` and `Other`-selected.
- Top-level `context` preamble (markdown) sets stakes before questions.
- Per-question `weight` badge (`critical` / `medium` / `easy`) signals reversibility.
- Per-question `model_lean` + `model_lean_reason` surfaces the model's recommendation without forcing it.
- Per-question `answers_affect_followup` flag sets expectations for branching.
- Read-only collapsed summary after submission.
- Works identically in native and Copilot engines.

**Non-Goals:**
- Multi-round conversation within a single `interview_me` call.
- Replacing `ask_me`.
- Animation beyond a simple opacity fade on description swap.
- Mobile-specific layout (desktop first).

## Decisions

### 1. New tool name: `interview_me`, new message type: `interview_prompt`

Separate from `ask_me` / `ask_user_prompt`. This keeps the two concepts cleanly separated in the DB, the type system, and the frontend router.

**Rationale:** Mixing the two would require the existing `AskUserPrompt.vue` to handle both rendering modes, adding branching complexity. A clean separation is simpler to build, test, and reason about.

### 2. Tool schema

```typescript
interview_me({
  context?: string,                  // markdown preamble
  questions: Array<{
    question: string,                // markdown
    type: "exclusive" | "non_exclusive" | "freetext",
    weight?: "critical" | "medium" | "easy",
    model_lean?: string,             // option title the model prefers
    model_lean_reason?: string,      // one-sentence reason
    answers_affect_followup?: boolean,
    options?: Array<{                // omitted for freetext
      title: string,
      description: string            // mandatory markdown
    }>
  }>
})
```

`description` on options is mandatory (unlike `ask_me` where it was optional). This enforces the tool's intent — if you use `interview_me`, every option must be documented.

### 3. Engine intercept: same pattern as `ask_me`

Both engines (native `workflow/engine.ts` and Copilot `engine/copilot/`) scan tool calls for `interview_me` before executing any tools. On detection:
1. Normalize the payload (validate required fields, default `type` to `"exclusive"` if missing).
2. Write an `interview_prompt` conversation message with the serialized JSON.
3. Set `execution_state = 'waiting_user'`.
4. Stop the tool loop.

**Nudge handling:** Same as `ask_me` — if the model calls `interview_me` with empty/missing questions, nudge up to 3 times before skipping.

### 4. Frontend: `InterviewMe.vue` component

**Layout per question:**

```
┌────────────────────────────────────────────────┐
│  [weight badge]  Question text                 │
│  🤖 AI leans toward X · reason text            │
│                                                │
│  ○ / ☐  Option A        ← row click = focus   │
│  ○ / ☐  Option B                              │
│  ○ / ☐  Other                                 │
│                                                │
│ ┌──────────────────────────────────────────┐  │
│ │  ## Option A                             │  │  ← fixed min-height: 200px
│ │  Description markdown rendered here...  │  │     scrollable overflow
│ │  ✅ Pro  ⚠️ Con                          │  │     opacity fade on swap
│ └──────────────────────────────────────────┘  │
│                                                │
│  Notes (optional)                             │
│ ┌──────────────────────────────────────────┐  │
│ │                                          │  │
│ └──────────────────────────────────────────┘  │
└────────────────────────────────────────────────┘
```

**Single-select (`exclusive`):** Clicking a row selects it AND focuses the description panel. No radio button rendered — row highlight is the affordance. Cursor: pointer on hover.

**Multi-select (`non_exclusive`):** Clicking a row focuses the description panel (does NOT check/uncheck). Clicking the checkbox checks/unchecks. The two gestures are independent. The description panel always shows the last focused row's description.

**Freetext:** Just a textarea. No options, no description panel, no Notes.

**"Other" option:**
- Row click: description panel replaced by a textarea for custom input.
- Notes field hidden (textarea covers the same purpose).
- No markdown description for Other (nothing to show).

**Description panel:**
- `min-height: 200px` — generous enough for most markdown content without feeling cramped.
- `max-height: 400px`, `overflow-y: auto` — scrollable for longer content.
- Opacity cross-fade (~100ms) when focused option changes. No height animation, no layout shift.
- Placeholder text when nothing is focused yet: *"Select an option to see details."*

**Weight badge rendering:**
```
critical → ⚠️ Hard to change later   (amber)
medium   → 🔄 Can change with effort  (blue)
easy     → 💡 Easy to revisit         (green)
```

**Model lean:**
```
🤖 I lean toward [Option A] · [one-sentence reason]
```
Rendered as a subtle line below the question text, above the options.

**`answers_affect_followup`:**
A small note at the bottom of the question section:
```
✦ Your answer here will shape follow-up questions
```

### 5. Submission format

Same pattern as `ask_me`: answers serialized as a human-readable string sent as a user message. Format:

```
Q: Which database engine?
A: PostgreSQL
Notes: We're also evaluating CockroachDB for geo-distribution.

Q: Which environments?
A: Local, Staging, Production

Q: Any compliance constraints?
A: SOC2 Type II, all PII must stay in eu-west-1.
```

### 6. Read-only state after submission

The widget collapses to a compact list:
```
✓ Which database engine? → PostgreSQL
  Notes: We're also evaluating CockroachDB...
✓ Which environments? → Local, Staging, Production
✓ Any compliance constraints? → SOC2 Type II, eu-west-1...
```

### 7. Tool group and column config

Registered in the `interactions` tool group alongside `ask_me`. Column configs opt in with `interview_me` in their `tools` array.

The tool description includes explicit ALWAYS instruction:
> "ALWAYS use this tool instead of plain prose when you need architectural direction, technology choices, or any decision where context and tradeoffs matter."
