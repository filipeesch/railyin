## Context

The Pi engine (`src/bun/engine/pi/`) wraps `@earendil-works/pi-coding-agent@0.74.0` and `@earendil-works/pi-agent-core@0.74.0`. Each conversation maps to exactly one `AgentSession`; the SDK's `Agent` rejects re-entrant `prompt()` calls via an internal `activeRun` lock. Intra-turn tool execution is already parallel (`toolExecution: "parallel"` is the SDK default), but in practice local models rarely emit more than one tool call per assistant turn, so the parallel path is mostly idle.

The user's target deployment is vLLM serving Qwen3-32B-A3B / Qwen3-30B-A3B. Continuous-batching backends scale near-linearly with concurrent in-flight requests up to ~16 for mid-size MoE models; the railyin Pi engine never produces this concurrency for a single coding task. Compaction makes the gap worse: `session.compact()` is itself an LLM call that blocks the next turn when context fills.

Five decisions framing this design (recorded via `decision_request` during explore mode):

1. **Strategy**: subagent / fan-out tool (no speculative pipelining, no draft+verify).
2. **Deployment target**: vLLM-first; provider concurrency is a config knob with vLLM-shaped defaults.
3. **Subagent surface area**: lightweight — in-memory child session, summary returned, no persistence, no DB rows, no UI components.
4. **Background compaction**: in scope. Soft threshold strictly lower than the SDK's hard threshold; non-blocking try-acquire on the limiter.
5. **Implementation scope**: railyin only. Pi SDK is fixed at v0.74.0.

## Goals / Non-Goals

**Goals**

- A single Pi conversation can produce N concurrent LLM requests during one assistant turn, driven explicitly by the model via a `delegate` tool.
- A bounded, observable per-provider concurrency cap covers parent, children, and background compaction — saturating the local server is no longer possible regardless of how many tasks/conversations are active.
- Compaction overlaps with parent work whenever a slot is free, and never queues behind foreground requests.
- Zero new UI components and no DB migration. Per-child progress is visible via the existing nested tool-call card rendering (`parentCallId` pattern, S-26).
- Pi SDK treated as fixed: implementation stays inside railyin.

**Non-Goals**

- Persisting child conversations or surfacing them on the board.
- Mid-flight parent↔child messaging, child→sibling messaging, or steering.
- Cross-task throughput improvements at the orchestrator level (the limiter helps indirectly but no orchestrator-level queueing is added).
- Speculative draft+verify, summarisation-on-a-different-model, or any new model-routing capability.
- Upstream Pi SDK changes.

## Decisions

### Decision 1 — Subagent communication is one-shot tool semantics, plus UI-only progress

The `delegate` tool is invoked once by the parent with `tasks: Array<{id, prompt, tools?}>`. Each child runs independently to completion. The final tool result is a single markdown digest the parent reads on its next turn. Per-child progress is visible in the UI through child `tool_start`/`tool_result` events tagged with `parentCallId = delegate_tool_call_id` and `isInternal: true` — these render as collapsible nested cards under the `delegate` tool call using the existing S-26 pattern, with no new UI code or new `EngineEvent` types required.

**Why not richer protocols**: Bidirectional messaging (AutoGen / CrewAI shape) costs an extra LLM round-trip per message and is reliably mishandled by local models under 70B. A child→parent `report` tool was considered and rejected for v1: it introduces a new contract that local models would over- or under-use, and the same information arrives via the final digest anyway. The pure one-shot pattern matches Claude Code's `Task` and Copilot's `explore`/`research` subagents.

### Decision 2 — One transport, one limiter, all sessions

The limiter and `Transport` wrapper live at the level of `defaultSessionFactory`, not on `PiEngine` itself. Every `AgentSession` ever created — parent, every child, every background compaction call — receives the same transport. There is no separate code path for "child sessions" or "compaction sessions" at the HTTP layer.

**Why not per-purpose pools**: Splitting pools by purpose (e.g. one for foreground, one for compaction) requires either a priority scheme or risks oversaturating the server. A single FIFO queue keyed by provider name is simpler and lets `max_inflight` be the only knob users have to reason about.

### Decision 3 — `max_inflight` default = 8

vLLM with Qwen3-MoE handles 8+ concurrent requests with near-linear throughput scaling. Defaulting to 2 (LM Studio-safe) would leave the headline win off by default for the user's actual setup. The LM Studio case is handled by a startup warning when `max_inflight > 2` and the `base_url` host is `localhost`/`127.0.0.1` on port `1234`.

**Alternatives considered**:
- Default 2 (safe everywhere) — wastes vLLM throughput; users must remember to crank it up.
- Auto-detect provider type from `/v1/models` response — brittle, reverse-engineers semver fields.

### Decision 4 — `delegate.max_concurrency` derived, not configured

When the model omits `max_concurrency` and the user does not override `harness.delegate.max_concurrency`, effective concurrency is `min(tasks.length, max_per_call, provider.max_inflight)`. With the defaults this is `min(N, 5, 8) = min(N, 5)`, leaving 3 slots on a single-task vLLM workload for background compaction and other conversations.

**Why not a separate default**: A standalone `delegate.max_concurrency` config drifts away from `provider.max_inflight` over time. Deriving it gives users one knob to think about; the override remains for niche cases.

### Decision 5 — Background compaction is opportunistic, non-blocking

After each `turn_end`:

```
if tokens >= softThreshold
   and !session.isCompacting
   and no in-flight bg compact for this conversation
   and limiter.tryAcquire(provider) returns a release token
then
   fire-and-forget session.compact()
   release the slot in finally()
else
   do nothing (SDK hard threshold remains the safety net)
```

`softThreshold = contextWindow − (reserveTokens + early_margin_tokens)`. Default `early_margin_tokens = 8192`; combined with the SDK's `reserveTokens = 16384` the soft trigger always precedes the hard one by 8K tokens.

**Why opportunistic-only**: Reserving a slot for compaction adds complexity (priority semaphore) and could overload the server transiently. The user explicitly accepted the worst case: when the limiter is saturated, compaction is skipped and the SDK's hard threshold runs it synchronously on the next turn. Worst case = today's behaviour.

### Decision 6 — Children get a strictly read-only tool surface by default

`buildAllTools({ columnGroups: ["read"] })` plus a filtered subset of `COMMON_TOOL_DEFINITIONS` containing only read-shaped board tools (`get_task`, `list_tasks`, `get_board_summary`, `list_todos`, `get_todo`, `list_decisions`). Children never receive: `write`, `shell`, `web` (unless explicitly allowed), `delegate` (recursion banned), `decision_request`, `create_task`, `move_task`, `update_todo_status`, `record_decision`, or any undo/transition tools.

`harness.delegate.allow_tools` (default `["read"]`, allowed values `["read","web"]`) gates which extra groups the user can opt in to.

**Why so restrictive**: Subagents that can write or transition tasks while running concurrently with their parent create undefined ordering for shared state. The lightweight v1 cannot model that — the constraint will be revisited only when persistence is added.

### Decision 7 — Child sessions use in-memory sessions via `SessionManager.inMemory()`

During implementation, the Pi SDK 0.74 was found to expose a `SessionManager.inMemory()` factory. Children use this directly — no filesystem temp files are created or deleted. This is cleaner than the original design which anticipated needing `mkdtemp` + cleanup.

**Original assumption**: `SessionManager.open(path)` requires a filesystem path; an in-memory variant was not expected to be exposed. The original plan called for `mkdtemp` + a `.jsonl` under `${PI_SESSIONS_DIR}/delegate-${parentConvId}/${jobId}.jsonl`.

**Actual implementation**: `SessionManager.inMemory()` is used directly in `child-session.ts`. No temp-file cleanup is needed in `finally`.

### Decision 8 — Failures isolated per child; parent always gets a result

`Promise.allSettled` ensures one slow or failing child doesn't abort the batch. Per-child errors become structured entries in the digest:

```markdown
### job-a
Found 3 candidate files: src/auth/login.ts, src/auth/jwt.ts, src/auth/middleware.ts.

### job-b
**error**: LM Studio tree_reduce bug — retry as a smaller subagent or use a different model.
```

Errors share the existing `tree_reduce` rewrite helper from `engine.ts`; extract to a small `formatPiError(error: Error): string` helper that both the parent and `delegate` use.

## Risks / Trade-offs

- **Model rarely invokes `delegate`** → primary failure mode for the whole feature. Mitigation: add a one-paragraph nudge in the system prompt suffix (only when `delegate` is in the active tool set) suggesting it for parallelisable read/analysis tasks. Ship sample `.github/prompts/` skills that explicitly call `delegate` so users can opt in via slash commands while we learn which model sizes actually use it spontaneously.
- **LM Studio over-saturation under default `max_inflight=8`** → startup warning when `base_url` matches the LM Studio convention. The user is one config line away from `max_inflight: 2`.
- **No subagent persistence → debugging gap** → temp session files are kept *only* during execution; after `dispose` they vanish. Mitigation: forward child raw-model events to `onRawModelMessage` with a `parentToolCallId` so the existing raw-events panel surfaces them live. The decision to add persistent storage is deferred until users hit the gap in practice.
- **vLLM `/v1/models` does not expose context length** → background compaction needs `session.getContextUsage()` which the SDK already provides. Independent of provider quirks.
- **Limiter starvation of background compaction** → accepted. When the limiter is saturated the SDK's hard threshold catches it; worst case = pre-change behaviour.
- **Cross-conversation interference** → multiple conversations on the same provider share one limiter. A heavily fanning-out task can slow down others. Acceptable for v1 — surface metrics so users can observe the contention.
- **MLX `tree_reduce` SDK bug** → already handled for parent; the same `formatPiError` rewrite path covers child failures. No additional risk.

## Migration Plan

No migration: the feature is additive and opt-out via config.

- Existing Pi engine configurations continue to work. `providers[*].max_inflight` defaults to 8; users on LM Studio see a warning and lower it. Users who do nothing get the new default and either benefit (vLLM/Ollama with `OLLAMA_NUM_PARALLEL ≥ 4`) or hit the LM Studio warning.
- The `delegate` tool is only loaded when the workflow column includes the `"delegate"` group. Existing columns without it get no behaviour change.
- Background compaction defaults `enabled: true` but is non-blocking by construction. To roll back fully, users set `harness.background_compaction.enabled: false`.
- No DB migration. No frontend rebuild needed.
- Rollback: disable `harness.delegate.enabled` and `harness.background_compaction.enabled` in config; restart. The limiter remains active and harmless.

## Open Questions

- Should `harness.delegate.allow_tools` ever allow `"shell"` for read-only shell commands (e.g. `git log`, `grep`)? Out of scope for v1, but worth revisiting if delegate adoption is strong.
- Should the LM Studio warning fail-fast in CI / refuse to start, or only warn? Current decision: warn only — users may legitimately use LM Studio with `max_inflight=2` and a custom port.
- Long-term: child→parent persistent transcripts. If/when added, the design here changes only by replacing the temp-file `SessionManager` and adding a `conversations.parent_conversation_id` column. No breaking change to the `delegate` tool contract.
