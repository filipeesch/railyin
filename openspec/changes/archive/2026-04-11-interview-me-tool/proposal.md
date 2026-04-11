## Why

When an AI agent needs direction on complex or architectural decisions, it currently has two options: ask in plain prose (easy to miss, no structure) or use `ask_me` (designed for quick structured choices, not deep deliberation). Neither is suited for high-stakes questions where the user needs to understand the full implications of each path before committing.

The `interview_me` tool creates a dedicated interaction mode for decisions that matter — architecture choices, technology selection, constraint gathering — where the model acts as an interviewer presenting rich, markdown-documented options and the user makes informed decisions with full context visible.

## What Changes

- A new `interview_me` tool is exposed to AI models, distinct from `ask_me`, with a tool description that instructs the model to ALWAYS use it instead of plain prose when seeking directional input on complex decisions.
- The tool accepts a top-level `context` preamble, an array of questions, each with a `type` (`exclusive`, `non_exclusive`, or `freetext`), an optional `weight` badge, an optional model `lean` with reason, and an optional `answers_affect_followup` hint.
- Each option has a `title` and a mandatory `description` in markdown — the description is the key differentiator, providing full implications, tradeoffs, and examples.
- A new `interview_prompt` message type is stored in the conversation and rendered as an `InterviewMe` UI component.
- The UI renders questions vertically. Options are listed as clickable rows (no radio buttons for single-select). Clicking a row focuses it and renders its markdown description in a fixed-height panel below the options. For multi-select, the checkbox is a separate gesture from the row focus click.
- Each question (except `freetext`) has a persistent Notes textarea at the bottom, hidden when "Other" is selected (Other's textarea serves the same purpose).
- After submission the widget collapses into a compact read-only summary.

## Capabilities

### New Capabilities
- `interview-me-tool`: The `interview_me` tool definition, engine interception (native + Copilot), message type, and frontend component.

### Modified Capabilities
- `engine-common-tools`: Tool group registry gains a new `interview_me` group entry.

## Non-Goals

- Multi-round back-and-forth interviews (single exchange only, like `ask_me`).
- Replacing `ask_me` — the two tools coexist, targeting different decision weights.
- Mandatory use — columns opt in via tool config like any other tool.

## Impact

- New: `src/mainview/components/InterviewMe.vue`
- Modified: `src/bun/workflow/tools.ts` — tool definition + group registration
- Modified: `src/bun/workflow/engine.ts` — intercept + normalize + message write
- Modified: `src/bun/engine/copilot/` — same intercept for Copilot engine
- Modified: `src/bun/engine/types.ts` — `interview_me` EngineEvent variant
- Modified: `src/mainview/components/MessageBubble.vue` — route `interview_prompt` messages
- Modified: `src/shared/rpc-types.ts` — `InterviewQuestion` and `InterviewOption` types
- No new dependencies
