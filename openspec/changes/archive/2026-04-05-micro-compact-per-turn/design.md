## Context

`compactMessages()` in `engine.ts` currently:
1. Finds the last `compaction_summary` and uses it as baseline 
2. Processes all messages after it into `AIMessage[]` objects
3. Truncates individual tool results at `TOOL_RESULT_MAX_CHARS` (8,000 chars)

Step 3 handles *large* individual results but does nothing about *accumulation* — 20 file reads of 1,000 chars each are 20,000 chars that stay in context forever, even if those files were read once and never revisited.

The proposed micro-compact pass adds a step between 2 and 3: apply a **recency window** so that tool results beyond a certain age in the conversation are cleared to a sentinel string before the payload is sent to the model.

## Goals / Non-Goals

**Goals:**
- Reduce assembled context token usage on every turn without requiring a full compaction call
- Delay auto-compact triggers, reducing the frequency of expensive summarization API calls
- Keep implementation entirely within `compactMessages()` — no new services, no background work

**Non-Goals:**
- Modifying stored conversation data in the DB
- Changing the auto-compact threshold or trigger logic
- Clearing user messages, assistant text, or `ask_me` results (those are always relevant)
- Exposing the decay behavior in any UI

## Decisions

### D1: Recency window defined by turn distance, not absolute age
**Decision**: Count AI "turns" (assistant message boundaries) from the most recent one. Tool results from turns older than `MICRO_COMPACT_TURN_WINDOW` (default: 8) are cleared.

**Rationale**: Token age is conversational, not calendar. A file read from 8 turns ago is stale in context; a file read 30 seconds ago but in the same turn is not. Turn-counting is stable and easy to reason about. An absolute token cutoff would be complex to implement without re-tokenizing.

**Alternatives considered**:
- Absolute token budget: clear oldest results first until under budget — more precise but requires token counting per message on every turn
- Time-based (wall clock): irrelevant for async tasks; not a useful signal

### D2: Which tool results to clear
**Decision**: Clear results from: `read_file`, `run_command`, `search_text`, `find_files`, `fetch_url`, `patch_file`. Do NOT clear: `ask_me`, `spawn_agent` (sub-agent outputs are often the primary result the model is working from).

**Rationale**: The "clearable" tools produce transient lookup results. The "keep" tools produce user intent (`ask_me`) or completed work products (`spawn_agent`). Clearing a sub-agent result would lose the work that was done.

### D3: Sentinel string content
**Decision**: Replace cleared content with `[tool result cleared — content no longer in active context]`.

**Rationale**: The model should know the result existed but was cleared, not that no result came back. This prevents the model from re-running the same tool thinking it failed, while still freeing the tokens.

## Risks / Trade-offs

- **Model re-runs cleared tools unnecessarily**: A model that references an old file read and finds it cleared may re-read the file. → This is acceptable: re-reading is cheap, and the alternative (keeping all tool results forever) is worse. The sentinel string tells the model the result was cleared, not that the call failed.
- **Turn counting is approximate**: If the model makes many tool calls within one turn, they all share the same age. → This is fine — turn-level granularity is the right level for this heuristic.
- **Wrong tools cleared**: If the clearable list misses a high-churn tool or incorrectly includes a semantically-important one → Mitigation: the list is a named constant (`MICRO_COMPACT_CLEARABLE_TOOLS`) and can be tuned based on observation.
