## Why

The Pi engine targets local LLM servers, but a single coding task today issues at most one LLM request at a time per conversation. Local backends — especially vLLM and SGLang — only deliver their advertised throughput when the server sees concurrent in-flight requests (continuous batching). On a Qwen3-32B-A3B / Qwen3-30B-A3B setup the engine is leaving most of the available throughput on the table and every coding turn runs serially even when work is trivially parallelisable. Compaction makes this worse: it is a multi-second blocking LLM call that fires at the worst possible moment.

This change introduces explicit, model-driven fan-out for a single coding task, plus the limiter and opportunistic-compaction plumbing required to make it safe across all Pi sessions.

## What Changes

- New `delegate` tool on the Pi engine: parent agent emits one tool call with N independent sub-prompts; railyin spawns N short-lived child `AgentSession` instances that run concurrently and return a consolidated markdown digest.
- Children are pure functions of `(prompt, tools) → final text`. No mid-flight parent↔child messaging. Default child tool set is read-only; never `write`, `shell`, board-mutating common tools, or recursive `delegate`.
- New per-provider concurrency limiter + shared `undici` keep-alive pool covering parent, children, and background compaction. Bounded semaphore (`max_inflight`, default **8** — vLLM-shaped) with FIFO wait queue and abort-aware acquire/release.
- New `Transport` wrapper plugged into `AgentOptions.transport` so every Pi LLM call is routed through the limiter, regardless of which session originated it.
- Opportunistic background compaction: after each `turn_end`, if context usage exceeds a soft threshold and a limiter slot is free *right now*, kick off `session.compact()` fire-and-forget. If no slot is free, do nothing — the Pi SDK's existing hard threshold remains the safety net.
- Extended `PiEngineConfig` shape: `providers[*].max_inflight`, `providers[*].queue_timeout_ms`, `harness.delegate.{enabled,max_per_call,max_concurrency,allow_tools}`, `harness.background_compaction.{enabled,early_margin_tokens}`.
- Startup warning when a provider has `max_inflight > 2` and its `base_url` looks like LM Studio (host = `localhost`/`127.0.0.1`, port `1234`).
- Live per-child progress visible in the UI via child `tool_start`/`tool_result` events tagged with `parentCallId = delegate_tool_call_id` and `isInternal: true`. These render as collapsible nested cards under the `delegate` tool call using the existing S-26 pattern. No new UI components or `EngineEvent` types are needed.

## Capabilities

### New Capabilities
- `pi-engine-parallelism`: per-provider concurrency limiter, `delegate` subagent tool, opportunistic background compaction, and the configuration surface that controls them.

### Modified Capabilities
None. All observable behaviour belongs to the new `pi-engine-parallelism` capability; the changes inside `pi-engine` (transport wiring, shutdown cancellation, turn-end hook) are implementation details that satisfy the new capability's requirements.

## Impact

- **Code**: `src/bun/engine/pi/engine.ts`, new `src/bun/engine/pi/provider-limiter.ts`, new `src/bun/engine/pi/provider-transport.ts`, new `src/bun/engine/pi/tools/delegate.ts`, new `src/bun/engine/pi/child-session.ts`, `src/bun/engine/pi/tools/index.ts`, `src/bun/config/index.ts`.
- **Config**: `config/engines.yaml.sample` gains documented examples for `max_inflight`, `harness.delegate`, `harness.background_compaction` with a vLLM/Ollama/LM Studio matrix.
- **Dependencies**: `undici` (already a transitive dep via Pi SDK) used directly for the shared HTTP pool.
- **APIs**: No external RPC changes. New internal `getPiProviderStatus()` helper exposes limiter metrics for future surfacing.
- **Tests**: New unit tests under `src/bun/test/pi/` for the limiter, the delegate tool (with injected child factory), and background-compaction trigger math.
- **Behaviour**: The Pi SDK is treated as fixed (v0.74.0); no upstream changes. No DB migration, no new UI components, no new `EngineEvent` types — per-child progress reuses the existing `parentCallId` nested-card rendering (S-26 pattern).
