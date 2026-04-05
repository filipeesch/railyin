## Context

`compactConversation()` in `engine.ts` currently sends the entire conversation history to the model with a one-line system prompt: *"You are a conversation summarizer. Given the conversation history below, produce a compact summary…"*. The resulting summary is stored as a `compaction_summary` message and injected as a `system` message on all subsequent turns.

Because the prompt gives no structure, the model produces prose summaries that often: paraphrase user instructions instead of quoting them, omit file names and code snippets, and fail to anchor "what was being worked on right before this compaction". After compaction, the model must re-infer the task from lossy prose, causing subtle drift over multi-compaction sessions.

## Goals / Non-Goals

**Goals:**
- Replace the one-line prompt with a structured template that forces the model to capture: verbatim user instructions, active code/file context, pending tasks, and a "current work" anchor with direct quotes
- Add an explicit scratchpad phase (`<analysis>` block) that the model uses for reasoning before writing the final output — preventing shallow one-pass summaries
- Strip the `<analysis>` block before storing, so only the structured `<summary>` content is saved to the DB and injected into context

**Non-Goals:**
- Changing when compaction is triggered (threshold, manual vs auto)
- Changing the DB schema or message types
- Changing the UI — the stored summary is rendered as-is

## Decisions

### D1: Structured output with XML delimiters vs. JSON vs. prose sections
**Decision**: Use `<analysis>` + `<summary>` XML blocks with markdown sections inside `<summary>`.

**Rationale**: JSON is fragile (models sometimes omit closing braces under long context). Plain markdown sections without a scratchpad produce shallower analysis. The `<analysis>` / `<summary>` split is the same pattern Claude Code uses — the analysis block is a drafting scratchpad that gets stripped; the summary block is what gets stored. XML block boundaries are easy to parse with a simple regex.

**Alternatives considered**:  
- JSON with defined keys: more structured but parsing failures are common at context limits  
- Just markdown without scratchpad: simpler but produces lower-quality summaries on first pass

### D2: Where to strip the `<analysis>` block
**Decision**: Strip in `compactConversation()` after receiving the model response, before storing to DB.

**Rationale**: The analysis content is never useful to store — it's reasoning scratch work. Stripping it before storage keeps the `compaction_summary` message clean and doesn't add any parsing complexity at read time (which would affect every subsequent API call assembly).

### D3: Prompt verbosity vs. model compliance
**Decision**: Include explicit section headers and an example in the prompt despite the added prompt length.

**Rationale**: The prompt is sent only once per compaction (not every turn), so its token cost is amortised. A more explicit prompt with an example produces more consistent structure. Claude Code's prompt is ~1,000 words and includes a full example — the investment pays off in output reliability.

## Risks / Trade-offs

- **Model non-compliance on weak models**: Smaller/local models may not follow the structured prompt reliably and may omit sections or ignore the `<analysis>` block requirement. → Mitigation: the `<analysis>` stripping uses a regex that gracefully falls back to the full output if no `<analysis>` block is found; section omissions still produce a better summary than the current one-liner.
- **Longer summaries may themselves be large**: A richer prompt produces richer output, which uses more context. → Mitigation: the summary replaces the entire conversation history, so even a 2,000-token summary is far smaller than a full 50-turn conversation. No change to the compaction trigger threshold is needed.
- **Prompt drift**: Future changes to the engine may not update the prompt alongside them. → Mitigation: the prompt is a named constant (`COMPACTION_PROMPT`) at the top of the file.
