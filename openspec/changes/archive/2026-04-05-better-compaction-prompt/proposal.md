## Why

When a conversation is compacted, the resulting summary becomes the sole foundation the AI model reads for all future turns. Our current compaction prompt is a single generic sentence, producing summaries that omit code snippets, lose exact user instructions, and leave the model uncertain about what task it was mid-way through. This causes post-compaction drift — the model paraphrases the user's intent rather than preserving it verbatim.

## What Changes

- Replace the single-sentence `COMPACTION_SYSTEM_PROMPT` in `engine.ts` with a structured, multi-section prompt that directs the model to produce a rich, actionable summary
- The summary template will include: primary request and intent, key technical concepts, files and code sections (with snippets), errors and fixes, problem solving, verbatim user messages, pending tasks, current work description, and optional next step with direct quotes
- Add a scratchpad `<analysis>` phase in the prompt that the model uses internally before writing the final summary (prevents shallow one-pass outputs)
- Strip the `<analysis>` block from the stored summary (only the `<summary>` block is saved)

## Capabilities

### New Capabilities

- `compaction-prompt`: Structured compaction prompt template that produces faithful, drift-resistant conversation summaries

### Modified Capabilities

- `conversation-compaction`: The compaction requirement for summary quality is strengthened — summaries must now preserve verbatim user instructions, active code context, and a "current work" anchor to prevent post-compaction task drift

## Impact

- `src/bun/workflow/engine.ts`: `COMPACTION_SYSTEM_PROMPT` constant and `compactConversation()` function (post-processing to strip `<analysis>` block)
- No DB schema changes, no API changes, no UI changes
- Backward compatible: existing `compaction_summary` messages continue to work; only new summaries are affected
