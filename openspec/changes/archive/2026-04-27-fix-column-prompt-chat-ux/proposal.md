## Why

Entered-column prompts currently show up in task chat as a weak transition line followed by a dominant raw prompt block. That makes workflow state changes hard to scan, exposes orchestration text as if it were a normal chat turn, and can misrepresent what the engine actually received when slash references are resolved.

## What Changes

- Redesign entered-column chat UX around a structured transition card instead of a generic prompt bubble.
- Make the transition card the primary artifact for column-entry automation, showing exact workflow wording with source and target columns.
- Represent executed entered-column instructions in expandable details, collapsed by default, and render them with the same inline chip treatment used for normal chat prompts.
- Persist enough structured transition metadata for the UI to render the card without inferring semantics from neighboring messages.
- Stop making raw authored `on_enter_prompt` text the primary user-visible history for column-entry executions.
- Extract shared prompt-like rendering helpers and a dedicated transition-card UI path so the feature does not expand `MessageBubble.vue` into a god component.
- Keep transition execution changes aligned with existing dependency-injected seams rather than introducing alternate mock-only code paths.

## Capabilities

### New Capabilities
- None.

### Modified Capabilities
- `conversation`: transition events need richer structured metadata and updated history semantics for entered-column executions.
- `workflow-engine`: entering a prompted column must persist and expose executed prompt details in a way that supports the transition-card model.
- `task-detail`: task chat must render entered-column transitions as structured cards with collapsed instruction disclosure instead of raw prompt-first bubbles.

## Impact

- Frontend conversation rendering in `src/mainview/components/MessageBubble.vue`, `ConversationBody.vue`, and related task-chat components.
- Shared conversation contracts in `src/shared/rpc-types.ts`.
- Transition execution persistence in `src/bun/engine/execution/transition-executor.ts` and related conversation message handling.
- Follow-on cleanup likely around prompt/transition ownership so transition UX is not spread across generic message-bubble conditionals.
- Feature implementation may extract small pure helpers to keep rich prompt rendering and transition formatting testable without introducing a new frontend component-test harness.
