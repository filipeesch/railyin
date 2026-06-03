## Context

The Pi engine supports local LLMs (vLLM, Ollama, LM Studio) which have weaker instruction-following than frontier models. Three tool surfaces are frequently misused:

1. **`decision_request`**: Local LLMs put all options as text in the `question` field and send a single dummy option like `"Select one"`, making the UI show no real choices and forcing the user to type a free-text answer via the "Other" path.
2. **`skill` tool**: When the model sends a wrong or mangled skill name, the error message only says "not found — check `<available_skills>`", which the model already read. It has no way to self-correct without re-reading the whole system prompt.
3. **Board tools**: `get_board_summary`, `list_tasks`, and `create_task` expose an optional `board_id` parameter. Models running inside a task context should always omit it (the executor already resolves it from `ctx.boardId`), but local LLMs frequently hallucinate wrong numeric IDs, producing tool errors.

All three fixes are independent and localized — no new abstractions, no new external dependencies.

## Goals / Non-Goals

**Goals:**
- `decision_request`: Prevent the model from calling with fewer than 2 options on `exclusive`/`non_exclusive` questions; surface a clear, actionable error.
- `decision_request`: Tighten and deduplicate the tool description so local LLMs understand the contract without redundant prose.
- `skill` tool: Enumerate available skills in the error message when a name is not found; fuzzy-suggest the closest match.
- Board tools: Remove `board_id` from the three tool schemas to eliminate the hallucination vector entirely.

**Non-Goals:**
- Not changing how `freetext` questions work (they have no options by design).
- Not adding new board tools or changing the board tool executor logic.
- Not changing the `ask_me` tool (different surface, different problems).
- Not adding tests in this change (tracked separately).

## Decisions

### D1: Schema `minItems: 2` on `decision_request` options

The `options` array in the `questions` items schema gets `minItems: 2`. AJV catches this before execution and returns a descriptive error via the existing `validateToolArgs` path. This is consistent with how `questions` itself already enforces `minItems: 1`.

**Why not runtime-only?** Schema-level constraints self-document the contract in the tool definition that gets sent to the model, improving generation-time compliance.

**Why also runtime?** AJV `minItems` is type-agnostic — it fires even for `freetext` questions where options are meaningless. A runtime check in `executeCommonTool` (right before the suspend path) provides the type-aware guard: only reject when `type !== "freetext"` and `options.length < 2`, with a message that explains *why* and *what to do instead*.

### D2: `SkillResolver.list()` interface extension

The `SkillResolver` interface gains:
```ts
list(): Promise<string[]>
```
`FileSystemSkillResolver` implements it by iterating `this.paths`, reading each directory's entries, and collecting names of subdirectories that contain a `SKILL.md` file. Deduplication by name (first-path-wins, same as `resolve()`).

The `skill` tool's `execute` function calls `resolver.list()` only on error (lazy — no overhead on happy path). It then:
1. Builds a lowercase lookup map of available names.
2. Checks if `args.name.toLowerCase()` matches any entry → "Did you mean: `<name>`?"
3. Always appends the full list.

**Why extend the interface rather than add a concrete method?** `SkillResolver` is already an interface used for test injection (`InMemorySkillResolver`). Adding `list()` to the interface keeps the mock and production implementations in sync and makes the method discoverable via type-checking.

### D3: Remove `board_id` from three schemas

`registry.ts` is the single source of truth for tool schema definitions. Removing `board_id` from:
- `get_board_summary`
- `list_tasks`
- `create_task`

is a one-line removal per tool. The executor (`BoardToolExecutor`) already reads `ctx.boardId ?? 0` as fallback — no executor changes needed. The removed fields don't need deprecation notices; they were optional and the behavior is identical from the caller's perspective.

**Why not "improve description" instead?** Description hints are ignored by weak local models. Schema field presence directly shapes the model's sampling — removing the field is the only reliable prevention.

**Why not remove from `edit_task`, `delete_task`, `move_task`, `message_task` too?** Those tools operate on a `task_id`, not a board, so `board_id` was never in their schemas. No change needed there.

### D4: Description tightening for `decision_request`

The current description ~900 chars is ~40% repetition between the top-level description and field descriptions. The rewrite:
- Moves option structure requirements exclusively to field descriptions
- Keeps the top-level description focused on *when* to use the tool and the *"never embed options in question text"* rule
- Adds a concise constraint line: `"For 'exclusive'/'non_exclusive': options MUST contain ≥ 2 items. Never list choices in the question text."`

## Risks / Trade-offs

- **`minItems: 2` breaks `freetext` questions that accidentally pass options** → Runtime guard exempts `freetext`, schema guard applies uniformly. Mild: `freetext` + options is already a misuse, so rejecting it is correct.
- **Removing `board_id` breaks cross-board tool calls from agents** → Accepted. No known legitimate use case for an agent to query a *different* board. If needed, it can be added back with a clear description distinguishing it from the default.
- **`list()` on `SkillResolver` adds a filesystem scan on every skill miss** → Negligible: skill misses are rare and short-circuit to a directory listing, not file reads. `FileSystemSkillResolver` is already doing filesystem I/O in `resolve()`.

## Migration Plan

All changes are backward-compatible at runtime. No DB migrations, no API changes, no frontend changes. Deploy as a normal code push.

Rollback: revert the three file changes — no state to unwind.

## Open Questions

None.
