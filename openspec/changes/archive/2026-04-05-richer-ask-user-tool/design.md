## Context

The `ask_me` tool today has this shape:
```json
{
  "question": "Which approach?",
  "selection_mode": "single",
  "options": ["Option A", "Option B"]
}
```

Options are plain strings. There's no way to say "this one is recommended" or "here's what this option means". Claude Code's `AskUserQuestion` solved this by adding a `description` field (secondary explainer), a `recommended` bool, a `preview` field (markdown/HTML for visual comparison), and support for an array of questions in one call.

We follow the same direction, with our approach to multi-question kept simple: an array of question objects rather than one top-level question.

## Goals / Non-Goals

**Goals:**
- Add `description` and `recommended` to each option object
- Add optional `preview` (markdown string) to each option for visual comparison
- Support batching multiple questions in one `ask_me` call
- Backward compatibility: all new fields optional, existing schema still works

**Non-Goals:**
- HTML preview rendering (markdown only, safer and simpler)
- User ability to reorder options
- Option grouping / nested options

## Decisions

### D1: Option as object vs. union (string | object)
**Decision**: Change options from `string[]` to `object[]` with `label` (required), `description` (optional), `recommended` (optional bool), `preview` (optional string).

**Rationale**: A union type that allows both strings and objects makes tooling and runtime handling more complex. Since all new fields are optional, the object shape with only `label` is effectively the same as a plain string. Models that don't know about new fields will just omit them.

### D2: Multiple questions: array of question objects vs. nested calls
**Decision**: The tool input changes from a single top-level `question`/`options` to a `questions` array where each item has its own `question`, `selection_mode`, and `options`.

**Rationale**: Allows the model to batch related prompts (e.g., "Which files?" and "Which approach?") in one interaction, reducing back-and-forth. The UI renders them as a sequential form. The stored message captures all questions and their answers together.

**Alternative considered**: Keep single-question schema, add a `follow_up` field. Rejected — more awkward to compose and still requires multiple tool calls for multiple concerns.

### D3: Preview rendering
**Decision**: Render `preview` content as a markdown block in a bordered panel to the right of the option label (visible when the option is selected or hovered). No HTML — markdown only.

**Rationale**: HTML previews introduce XSS risk and require a sandboxed iframe. Markdown is safe and sufficient for code snippet comparison, which is the primary use case.

## Risks / Trade-offs

- **Older messages break if option format changes**: → All new fields are optional; rendering code must treat missing fields gracefully.
- **Model may not use new fields if description in system prompt isn't updated**: → The tool description in `tools.ts` should be updated to mention the fields and when to use them.
- **UI complexity**: Preview panes add conditional layout. → Preview is only rendered when the field is present; default rendering is identical to today.
