## Context

The refinement harness (`refinement/proxy.ts`, `runner.ts`, `engine-runner.ts`) currently supports three proxy modes: mock (scripted SSE), local (forward to LM Studio), and live (forward to Anthropic). The proxy captures full request bodies and cost estimates but has asymmetric data collection: mock captures estimated output tokens from scripts while local/live record 0. The proxy in local mode intercepts SSE to inject synthetic cache usage but discards actual response content. Three of five scenarios are mock-only because they rely on scripted model behavior (spawn_agent patterns). No timing data is recorded.

The auto-improve loop (`--mode auto`) currently runs in a single eval mode per invocation. Analysis and findings are generated from one mode's data, meaning structural optimizations validated in mock may not help real models, and behavioral patterns in local/live are never systematically captured.

## Goals / Non-Goals

**Goals:**
- Identical scenario coverage across mock, local, and live modes
- Response capture without buffering — stream to client while teeing to accumulator
- Per-request timing (TTFB, duration) for all modes
- Configurable model per mode with model name stored in reports
- Two runs per scenario in local/live for variance detection
- Multi-mode collection pipeline: gather all three modes' data before generating findings
- Fixture-backed scenarios so real models have real files to work with

**Non-Goals:**
- Changing the mock scripting mechanism (scripts stay as-is)
- Implementing an AI-driven analysis agent (findings generation remains human/AI-in-the-loop)
- Real Anthropic cache hit/miss detection (synthetic prefix-based simulation stays)
- Parallel scenario execution (scenarios remain sequential within a mode)

## Decisions

### D1: Streaming tee via chunk accumulator, not response cloning

**Decision**: In the existing `TransformStream` loop, push each decoded chunk to a `string[]` accumulator. On stream end, join and parse SSE events from the accumulated string.

**Alternatives considered**:
- `Response.clone()` + separate read: Doubles memory, risks backpressure
- `tee()` on the backend ReadableStream: Would require managing two readers, complicates error handling
- Post-hoc capture from engine callbacks: The engine's `onMessage` callback only sees parsed messages, not raw SSE events or timing

**Rationale**: The TransformStream already exists for local mode SSE injection. Adding `chunks.push(chunk)` has near-zero overhead and keeps capture co-located with the proxy.

### D2: Parse accumulated SSE into a ResponseCapture struct

**Decision**: After stream ends, parse the accumulated SSE string into a `ResponseCapture`:
```typescript
interface ResponseCapture {
  stop_reason: "end_turn" | "tool_use" | "max_tokens" | string;
  content_blocks: Array<
    | { type: "text"; text: string }
    | { type: "tool_use"; id: string; name: string; input: unknown }
    | { type: "thinking"; thinking: string }
  >;
  usage: { output_tokens: number };
  model: string;
}
```

For mock mode, synthesize `ResponseCapture` from the script entry (already known). This makes the capture file format identical across modes.

### D3: Timing via wrapper timestamps, not SSE event parsing

**Decision**: Record `Date.now()` at three points in the request handler:
1. `request_received_at`: top of `handleRequest`
2. `first_byte_at`: when first chunk arrives from backend (inside TransformStream)
3. `last_byte_at`: when stream reader reports `done`

Derive `ttfb_ms` and `duration_ms` from these.

**Alternative**: Parse `message_start` SSE event timestamp — but backends don't consistently include timestamps in SSE, and it's more fragile.

**For mock**: `first_byte_at = last_byte_at = request_received_at` (instant). This is correct — mock has no model latency.

### D4: Scenario YAML gets `prompt:` + `expected_behavior:`, keeps `script:`

**Decision**: Each scenario YAML has three execution paths:
- `script:` — used by mock (unchanged)
- `prompt:` — the real task prompt, used by local/live with `handleHumanTurn`
- `expected_behavior:` — behavioral assertions for local/live runs

```yaml
prompt: "Find the TypeScript file that defines 'class Config' and rename it to AppConfig."

expected_behavior:
  must_call: [search_text, edit_file]
  must_not_call: [run_command]
  max_rounds: 8
  must_complete: true
  ideal_rounds: 3
  ideal_tool_sequence: [search_text, read_file, edit_file]
```

Mock ignores `prompt:` and `expected_behavior:`. Local/live ignore `script:`.

### D5: Per-scenario fixture directories

**Decision**: Add `fixtures: <dir-name>` to scenario YAML. The engine-runner copies `refinement/fixtures/<dir-name>/` into the temp git repo before running.

Fixtures are small, checked-in project directories:
```
refinement/fixtures/
  basic-typescript/        ← tsconfig, src/config.ts, src/main.ts
  css-accessibility/       ← styles with missing ARIA, package.json
  multi-module/            ← multiple TS modules for search/explore tasks
```

The mock scenario runner doesn't need fixtures (tool results are scripted), so it skips the copy step.

### D6: Model configurable via CLI flags, stored in report

**Decision**: Add `--local-model` and `--live-model` flags to the runner:
- `--local-model`: Model ID for local mode (default: auto-detect from LM Studio via `lms ps`)
- `--live-model`: Model ID for live mode (default: `anthropic/claude-sonnet-4-20250514`)

The `RunReport` gets a new `model` field. Each `ScenarioReport` also stores the model used, since in multi-mode collection these differ.

### D7: Two runs per scenario in local/live, stored independently

**Decision**: For local and live modes, run each scenario twice. Store as:
```
reports/<timestamp>/
  local/
    requests/<scenario>/run-1/001.json 002.json ...
    requests/<scenario>/run-2/001.json 002.json ...
  live/
    requests/<scenario>/run-1/...
    requests/<scenario>/run-2/...
```

The behavioral summary aggregates both runs: averages for numeric metrics, union for tool sequences observed, max for round counts, AND for completion.

Mock mode continues with a single run (deterministic, no variance).

### D8: Multi-mode collection then analysis

**Decision**: The auto loop changes from:
```
collect(one mode) → analyze → find → apply → re-collect(one mode)
```
to:
```
collect(mock) → collect(local) → collect(live) → analyze(all) → findings → apply → re-collect(all)
```

The `--eval-mode` flag is removed. The loop always collects all three modes. If local or live backends are unavailable (no LM Studio, no API key), that mode is skipped with a warning but doesn't block the loop.

The analysis phase compares:
- Token costs across modes (mock provides ground truth for structural savings)
- Tool sequences in local vs live (behavioral differences between models)
- Round trip counts and timing (efficiency patterns)
- Variance between run-1 and run-2 (stability signal)

## Risks / Trade-offs

- **[Live mode cost]** → Running all scenarios twice in live mode costs real money. Mitigation: `--skip-live` flag to exclude live from collection; default to local-only for iterative development.
- **[Non-determinism in local/live]** → Two runs may not capture the full variance distribution. Mitigation: Two runs is a minimum; flag scenarios with high variance (>50% round trip difference) for manual review.
- **[Fixture maintenance]** → Fixture directories must be kept in sync with scenario intent. Mitigation: Fixtures are minimal (3-5 files each) and tested by CI.
- **[Response parsing fragility]** → SSE format varies slightly between providers. Mitigation: Parser handles missing fields gracefully, falls back to empty/zero.
- **[Breaking existing auto-loop runs]** → The `--eval-mode` flag removal is a breaking change. Mitigation: The flag is new (added this session, not released); no external users.
