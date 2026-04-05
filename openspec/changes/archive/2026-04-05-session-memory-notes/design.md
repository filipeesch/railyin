## Context

Today's context pipeline per AI call: `[system prompt] + [compaction_summary?] + [recent messages]`. There is no persistent, cross-compaction knowledge layer. If a task runs for 10 hours with 5 compactions, by turn 6 the model has lost context from turns 1–4 except what was captured in the last compaction summary.

Claude Code addresses this with a "session memory" service: a background forked agent that runs after every N turns and writes key facts to a `~/.claude/session_memory.md` file. That file is injected into the system prompt on all subsequent calls. It accumulates incrementally — each extraction pass adds to rather than replaces the file.

We'll implement the same pattern scoped to our architecture: a per-task notes file managed by a background async call after each turn.

## Goals / Non-Goals

**Goals:**
- Persistent notes file per task that survives compaction
- Non-blocking background extraction (main loop is not delayed)
- Notes injected into system prompt before conversation history
- UI exposure of current notes in task detail drawer

**Non-Goals:**
- Real-time note updates during streaming (extraction happens after turn completes)
- Cross-task memory sharing
- User ability to edit notes directly (read-only in UI for now)
- Notes as a searchable vector store

## Decisions

### D1: File storage vs. DB column
**Decision**: Store notes as a file on disk at a per-task path (e.g., `~/.config/railyin/tasks/<id>/session-notes.md`), not as a DB column.

**Rationale**: Notes are large, append-oriented, and don't need relational querying. File storage is simple to read/write, easy to debug, and avoids DB migration. The path is deterministic from task ID. Same approach as Claude Code.

**Alternatives considered**:
- DB BLOB column: requires migration, harder to inspect, no benefit for this use case
- DB JSON field: same downsides, adds parsing complexity

### D2: Extraction timing and frequency
**Decision**: Trigger extraction after every 5th AI turn (configurable via `SESSION_MEMORY_EXTRACTION_INTERVAL`). Extraction runs asynchronously — main loop does not await it.

**Rationale**: Running on every turn is wasteful for short interactions. Running too rarely means the notes lag behind. Every 5 turns is a reasonable default. Non-blocking is critical — users should never feel the extraction delay.

### D3: Extraction prompt structure
**Decision**: The extraction prompt asks the model to produce a structured markdown file with sections: Open Decisions, Key Files Changed, Technical Context, User Preferences Observed. The model is instructed to produce the FULL updated notes (not a diff) on each run.

**Rationale**: A full-replacement approach is simpler to implement (write file, done) and avoids merge complexity. The notes file is small enough that regenerating it fully on each extraction pass is cheap.

### D4: Notes injection position in system prompt
**Decision**: Inject as a clearly-labeled block at the end of the system prompt, before conversation history.

**Rationale**: System prompt position ensures the notes survive compaction (the compaction_summary replaces conversation history, not the system prompt). End-of-system-prompt placement ensures it's close to the conversation for attention weighting.

## Risks / Trade-offs

- **Extraction adds API cost**: Each extraction is a separate AI call. → Mitigation: interval-based, uses a small/fast model if available, can be disabled.
- **Notes grow unbounded**: Over many turns, the notes file gets large and itself consumes context. → Mitigation: extraction prompt instructs the model to summarize and prune, not just append. Hard cap: if the notes file exceeds `SESSION_MEMORY_MAX_CHARS`, it is truncated from the top before injection.
- **Async extraction may produce stale notes**: The notes may lag by a few turns. → Acceptable trade-off — notes are a background memory layer, not a real-time transcript.
- **File path conflicts**: Two concurrent runs for the same task could race. → Mitigation: write to a temp file and atomically rename. Extraction is rate-limited by the interval.
