## Context

The Pi engine runs local LLMs (LM Studio, Ollama, vLLM) via the Pi SDK's `AgentSession`. Smaller/quantized models frequently enter tool call loops — either repeating the same call verbatim (e.g. `read(file.ts)` × N) or cycling through a group of calls with identical arguments (e.g. `read(a) → grep(b) → ls(c)` repeated endlessly). No guard exists today; users must manually cancel the execution.

The Pi SDK's `Agent` class exposes `beforeToolCall` as a directly mutable property (type `(ctx, signal) => Promise<BeforeToolCallResult | undefined>`). Returning `{ block: true, reason }` injects an error tool result and lets the model react — no SDK monkey-patching or transport interception needed.

Sessions are reused across user turns (one `AgentSession` per `conversationId`), so loop state must reset per execution, not per session.

## Goals / Non-Goals

**Goals:**
- Detect same-tool-repeated loops (AAAA) and cyclic-group loops (ABCABC) within a single execution
- Block the offending call and return a clear model-facing error hint so the model can self-correct
- Apply the guard to both parent sessions and child (delegate) sessions
- Always enabled — no config flag, zero user action required

**Non-Goals:**
- Detecting loops that span multiple user turns
- Detecting loops in non-Pi engines (Claude, Copilot, OpenCode have their own retry handling)
- Configurable thresholds (hardcoded constants are sufficient; this is a safety net, not a tunable policy)
- Tracking tool call latency or cost within the detector

## Decisions

### Decision: Sliding window fingerprint counter (not consecutive-only)
A ring buffer of the last 15 tool call fingerprints is maintained. A call is blocked when any fingerprint appears ≥ 3 times within that window.

**Why not consecutive-only?** Consecutive detection misses cyclic patterns (ABCABC): A never appears 3 times in a row, only 3 times in the window. Sliding window catches both patterns with the same rule.

**Why window=15, threshold=3?** Window = threshold × max_expected_cycle_length (5). 3 repetitions is enough signal — most legitimate retries stop after 1–2 attempts. 15 slots cover cycles up to 5 tools long, which encompasses the most common local-LLM loop patterns.

**Alternatives considered:** Consecutive-only — simpler but misses group loops. Full history scan — O(N) per call; unnecessary at window=15.

### Decision: Fingerprint = toolName + sorted-keys JSON args (shallow)
Each call is fingerprinted as `"${toolName}:${JSON.stringify(args, sortedKeys)}"`. Shallow key sorting (not deep) prevents false misses from key-ordering differences in LLM outputs without the complexity of recursive sorting.

**Why include args?** Without args, `read` would be flagged after 3 distinct file reads — a clear false positive.

**Why normalize key order?** Some LLMs produce the same object with keys in different order across turns. Shallow sort handles the common case at negligible cost.

### Decision: beforeToolCall wired after session creation, reset per execution
`session.agent.beforeToolCall` is set in `createManagedExecution()` after `getOrCreateSession()`. Since sessions are reused across turns, the detector is stored in `HarnessContext` (per conversationId) and `reset()` is called at the top of each `createManagedExecution()` invocation.

**Why HarnessContext?** It already holds per-conversation harness state (`undoStack`, `worktreePath`). Adding `loopDetector` here keeps all per-conversation harness state in one place and avoids a new `Map` on `PiEngine`.

### Decision: Child sessions get a fresh detector per child, no reset needed
Child sessions are created fresh for each delegate invocation (one `session.prompt()` call per child). A `new ToolLoopDetector()` is instantiated inside `defaultChildSessionFactory` and wired before the single `prompt()` call — no reset logic needed.

### Decision: Block + inject hint (not hard abort)
`{ block: true, reason: "Loop detected: ..." }` lets the model receive an error result and attempt to recover or summarize. Hard abort throws away all progress and leaves the user with no output.

## Risks / Trade-offs

- **False positive on high-fan-out reads**: If a model legitimately reads the same file 3+ times within a single execution (e.g., re-reading context), it gets blocked. Mitigated by: threshold=3 is already lenient; a well-behaved model would rarely re-read the same file 3 times in one execution.
- **Model ignores the hint and retries the same call**: After blocking, the model may call a slightly different tool, resetting the streak — the loop continues at a lower frequency. Acceptable: the detector reduces the blast radius even if it doesn't stop every pattern.
- **Window size doesn't catch very long cycles**: Cycles > 5 tools long are not detected at window=15. These are rare in practice; the safety net covers the common cases.
- **beforeToolCall is reset on every execution**: If a model loops across the boundary of two consecutive automated executions (e.g., queue-triggered), each resets the detector and the loop goes undetected. Accepted: cross-execution loops are rare and harder to distinguish from legitimate repeated use.

## Migration Plan

No migrations needed. The guard is purely additive — existing sessions that were not looping are unaffected. No config changes, no API changes, no database changes.

## Open Questions

None. All design decisions settled during exploration.
