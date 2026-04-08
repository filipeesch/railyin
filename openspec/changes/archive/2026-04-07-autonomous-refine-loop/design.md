## Context

The refinement harness (`refinement/`) can run scenarios, collect per-request captures, and compare reports. Today this loop is manually driven: the developer reads output, decides what to change, edits code, and re-runs. The loop is capable of running autonomously but lacks the orchestration layer that would let an AI drive it.

The captures already contain everything needed: full request bodies, token counts per component (tools/system/messages), cache hit status, label (parent vs sub-agent), tools_hash stability. The gap is: no step that reads these captures, generates structured findings, grounds each in documentation, applies targeted changes, and verifies the improvement.

## Goals / Non-Goals

**Goals:**
- Autonomous finding generation from per-request captures
- Per-finding doc search (search + fetch at finding time, not upfront)
- Apply one finding at a time, re-run with `--compare`, commit or rollback per metric contract
- Structural loop runs in mock ($0); behavioral gate uses local mode if available
- Findings report written alongside the run report — auditable, with doc sources
- Stopping condition: no new findings OR 3-round plateau (< 1% total_cost improvement)
- Updated skill and prompt to document the autonomous workflow

**Non-Goals:**
- Modifying the proxy, engine, or DB — the loop analyzes app code but doesn't change harness internals
- Live mode in the autonomous loop — too expensive for iteration; live is manual-only
- Parallel finding application — always one at a time, sequentially, to isolate impact
- UI or dashboard for findings — JSON report is the output surface

## Decisions

### D1: Finding as first-class type in types.ts

Findings are the core intermediate artifact. Add a `Finding` interface to `refinement/types.ts` with fields: `id`, `category`, `source` (file + line + symbol), `evidence` (current metric, expected metric, doc_reference, doc_quote), `metric_contract` (metric name + before + expected_after), `change` (type + description), `status`.

The `status` lifecycle is: `pending → applied → confirmed | rolled_back | ineffective`.

**Alternative considered:** Keep findings as inline console output only. Rejected — not auditable, can't resume a loop mid-way, can't compare finding outcomes across runs.

### D2: Loop orchestration lives in runner.ts, not a separate script

`--mode auto` adds a new `runAutoLoop()` path inside the existing `runner.ts`. It reuses `runScenarioThroughEngine()`, `createProxy()`, `evaluateAssertions()`, and `compareReports()` — all already available.

**Alternative considered:** Separate `auto-loop.ts` script. Rejected — splits the entry point, duplicates proxy setup, harder to keep in sync with runner changes.

### D3: The AI (Copilot) is the finding analyzer, not TypeScript code

Finding generation is not a TypeScript function. It's a step in the skill instructions where the AI reads capture JSON files, applies pattern matching, searches Anthropic docs, and emits a `Finding[]` as JSON. The runner then reads this JSON and executes the apply/verify cycle.

This means the loop requires AI involvement — it can't run headlessly without a model. That's intentional: the analysis step is the value, and it needs language understanding to interpret tool descriptions, system prompt structure, and doc guidance.

The runner provides the scaffolding; the skill provides the intelligence.

**Alternative considered:** Hardcoded TypeScript heuristics (e.g., "if tools_tokens > 800, flag it"). Rejected — too brittle, can't adapt to new patterns, can't use doc guidance.

### D4: Per-finding doc search, not upfront cache

Each finding triggers a targeted `search_internet` + `fetch_url` for its specific optimization topic. This ensures relevance — a finding about cache prefix stability fetches caching docs, a finding about tool schema verbosity fetches tool-use best-practices.

**Alternative considered:** Fetch a fixed set of Anthropic doc pages at loop start and cache them. Rejected — different findings need different pages; a fixed set misses half the relevant guidance and over-fetches what isn't needed.

### D5: Rollback uses in-memory file buffers, not git

Before applying a finding's change, capture the current content of all files it touches. On rollback, write originals back. This is fast (< 1ms) and doesn't pollute git history with experimental changes.

Git stash was considered but adds latency and can interact badly with worktrees.

### D6: Behavioral gate is optional, not required

If `lms ps` shows no local model is running, skip Phase 2 and report: "behavioral gate skipped — no local model." The findings report records this. The loop still completes with structural improvements only.

This makes the loop useful even when LM Studio isn't available.

## Risks / Trade-offs

**[Risk] AI generates finding with wrong source file/line** → Mitigation: findings include the metric contract — if the specified metric doesn't improve after the change, rollback is triggered automatically regardless of source accuracy.

**[Risk] Rollback fails to restore a file correctly** → Mitigation: before applying any finding, write the original content to `reports/<timestamp>-auto/backups/<finding-id>/` as a safety net. File-level undo is always possible.

**[Risk] Loop runs indefinitely on a plateau** → Mitigation: hard stopping condition after 3 consecutive rounds where `total_cost` improvement is < 1%. The AI is instructed to skip findings it has already tried (`status: ineffective`).

**[Risk] Doc search returns irrelevant or outdated pages** → Mitigation: the AI includes the doc source URL and a direct quote in the finding. If the quote doesn't support the proposed change, the finding is invalid — the metric contract will catch it on rollback.

**[Risk] Structural improvements break behavioral correctness** → Mitigation: the behavioral gate (Phase 2, local mode) is designed exactly for this. A trim to a tool description that saves 50 tokens but causes the model to misuse the tool will fail behavioral assertions and rollback all Phase 1 changes.

## Open Questions

- Should the findings report be written incrementally (updated after each finding) or only at the end? Incremental is more resilient to crashes but requires atomic writes.
- Should `--mode auto` accept a `--max-rounds N` flag to cap iterations? Useful for CI or time-boxed runs.
- Should the AI be allowed to propose new scenario assertions if it discovers patterns the existing scenarios don't cover? Powerful but risks scope creep.
