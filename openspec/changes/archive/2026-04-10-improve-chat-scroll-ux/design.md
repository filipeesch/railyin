## Context

The current chat drawer renders the persisted conversation from `taskStore.messages`, then appends separate live-only UI blocks for streaming reasoning, streaming assistant output, and ephemeral status messages. Tool rows are also derived by regrouping consecutive `tool_call` / `tool_result` / `file_diff` messages after the fact. On the backend, conversation reads are ordered by `created_at ASC`, while message insertion relies on SQLite's default `datetime('now')`, which only has second precision.

That combination creates two classes of problems:

1. **Ordering drift**: multiple messages created within the same second can be read back in unstable order, and the frontend can further separate live items from their true timeline position.
2. **Display contract drift**: messages shown to the user are not always the same artifacts the engine consumes. Prompt resolution, Copilot tool results, and internal SDK events all need a clearer boundary between user-visible timeline content and under-the-hood execution details.

## Goals / Non-Goals

**Goals:**
- Preserve one canonical chronological order for persisted and live chat items
- Make anchored auto-scroll apply to reasoning and other live timeline growth, not only assistant text
- Show the user-visible slash/custom prompt invocation without leaking the resolved prompt body into the chat window
- Improve tool result rendering for empty outputs and Copilot-driven file edits
- Filter hidden/internal Copilot activity out of the visible conversation
- Keep the changes scoped to chat UX and event/message modeling, without changing the engine's core task workflow

**Non-Goals:**
- Redesigning the whole task drawer layout
- Replacing the conversation message schema with a brand-new event store
- Changing prompt resolution syntax or removing resolved prompt execution
- Changing the meaning of existing write-tool `file_diff` payloads outside the chat UI needs

## Decisions

### D1: Canonical conversation order is append order, not timestamp order

Conversation history will be treated as an append-only sequence ordered by a monotonic DB key (`id`), with all history reads and timeline assembly preserving that order. Timestamps remain informational metadata, but they are not the source of truth for chronology.

**Why:** `created_at` uses second precision, which is not strong enough for rapid sequences like `reasoning -> tool_call -> tool_result -> file_diff -> assistant`.

**Consequence:** backend queries that currently sort by `created_at` must switch to a stable append order, and UI grouping logic must consume the already-ordered stream without reshuffling semantic neighbors.

### D2: Live chat rendering must participate in the same timeline model as persisted messages

The drawer will treat streaming reasoning, streaming assistant output, and other live execution state as timeline-adjacent items, not as a separate visual lane. Auto-scroll behavior will observe total rendered timeline growth, including reasoning and status changes.

The scroll model remains anchored-to-bottom:
- auto-scroll is active while the user is within a small threshold of the bottom
- scrolling away pauses it
- returning to the bottom threshold resumes it

**Why:** the current watcher only reacts to `messages.length` and `streamingToken`, so reasoning growth can happen without scroll reconciliation.

### D3: Prompt display and prompt execution are separate concerns

For slash/custom prompts, the system will preserve the original user-visible invocation separately from the resolved prompt body used for execution. The visible chat item should reflect what the user actually typed. The resolved body stays in engine-only state or in metadata explicitly marked as non-display content.

For workflow-driven prompt entries (`role: "prompt"`), the system should render either:
- a compact prompt marker using display metadata, or
- nothing user-facing when the prompt is internal-only

but it must not render the full resolved prompt body as if the user typed it.

**Why:** the user-facing timeline should communicate intent, not dump internal prompt expansion.

### D4: Tool result rendering prefers explicit UX states over empty/raw fallbacks

Tool rows will render three explicit cases:

1. **Diff available** -> show structured file diff UI
2. **Readable output available** -> show output body
3. **No user-visible output** -> show an explicit empty-state message such as "No output produced"

For Copilot-originated file edits, the adapter will preserve richer SDK result data (`detailedContent`, structured contents, or other diff-like fields when available) so the UI can show added/removed lines rather than an empty collapsible shell.

**Why:** the current tool row assumes `result.content` is the whole story, which is not true for richer Copilot SDK responses.

### D5: Copilot event translation must preserve user-facing filtering metadata

The Copilot adapter will keep more of the SDK event/result shape instead of collapsing everything to `toolName` + `result.content`. Relevant metadata includes:
- detailed tool result content
- structured result content blocks
- event lineage and execution metadata useful for ordering
- origin/source or visibility-like metadata that indicates hidden/internal timeline events

The conversation pipeline will filter non-user-facing items before they become visible chat rows.

**Why:** the SDK already distinguishes some hidden/internal activity, but the current adapter discards that information too early for the UI to make the right call.

### D6: Typography change stays local to standard chat bubbles

The normal message font-size reduction applies to user and assistant chat bubbles only. Tool rows, diff views, and reasoning bubbles keep their specialized sizing unless a local adjustment is needed for consistency.

**Why:** the user request is about normal messages, not every technical surface in the drawer.

## Risks / Trade-offs

- **Ordering migration risk**: switching from `created_at` ordering to `id` ordering assumes inserts are the canonical chronology. That is already true for this code path, but all read sites need to be updated consistently.
- **Prompt visibility edge cases**: some workflow prompts are genuinely useful to surface, while others are just implementation detail. The rendering contract should support both instead of hardcoding a single presentation.
- **Copilot SDK variability**: some richer result shapes may differ by tool type or SDK version. The design should degrade gracefully to a placeholder instead of assuming every edit tool provides a perfect diff payload.
- **Filtering false positives**: over-aggressive hidden/internal filtering could suppress useful user-facing steps. Filtering should key off preserved SDK metadata first and only use heuristics when necessary.
