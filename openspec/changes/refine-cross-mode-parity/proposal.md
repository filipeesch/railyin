## Why

The refinement harness runs scenarios in mock, local, and live modes but collects different data in each. Mock captures output tokens and uses scripted turns; local/live capture no response data, no output tokens, no timings, and skip 3 of 5 scenarios. This makes cross-mode comparison impossible and limits the auto-improve loop to mock-only structural findings. We need all modes to run the same scenarios, collect the same data, and feed into a unified analysis phase before applying changes.

## What Changes

- **Streaming response capture in the proxy**: For local/live, tee each SSE chunk to a side-channel accumulator during passthrough (zero added latency). On stream end, parse accumulated events to extract content blocks (text, tool_use, thinking), stop_reason, and real output_tokens. Store alongside the request in the capture file.
- **Per-request timing data**: Record `request_received_at`, `first_byte_at`, `last_byte_at`, `ttfb_ms`, `duration_ms` on every proxied request across all modes.
- **Fix output_tokens in local/live**: Use real output_tokens from parsed response instead of the current hardcoded 0.
- **Configurable model per mode**: Add `--model` flag (or per-mode config) so local and live can use different models. Default live to `anthropic/claude-sonnet-4-20250514`, local to whatever's loaded. Store the model name in the run report.
- **Scenario parity**: All scenarios run in all modes. Each scenario YAML gets a `prompt:` field (used by local/live) alongside the existing `script:` (used by mock). Add `expected_behavior:` with hard gates (`must_call`, `must_not_call`, `max_rounds`, `must_complete`) and soft metrics (`ideal_rounds`, `ideal_tool_sequence`).
- **Scenario fixtures**: Each scenario references a fixture directory with project files (TypeScript, config, CSS, etc.) that the engine-runner seeds into the temp git repo, so real models have real files to work with.
- **Two runs per scenario in local/live**: Run each scenario twice, store both runs independently, aggregate (avg + variance) in the analysis phase.
- **Multi-mode collection before analysis**: The auto loop collects mock + local + live baselines before generating findings. Analysis compares tool sequences, round trips, timing, and completion across models.

## Capabilities

### New Capabilities
- `refinement-response-capture`: Streaming SSE response capture in the proxy with parsed content blocks, stop_reason, and real output_tokens for all modes
- `refinement-timing`: Per-request timing data (TTFB, duration) and per-scenario timing aggregation
- `refinement-scenario-parity`: Unified scenario format with script + prompt + expected_behavior + fixtures, running all scenarios in all modes
- `refinement-multi-mode-analysis`: Multi-mode collection pipeline (mock → local → live) with cross-mode comparison and aggregated findings

### Modified Capabilities
- `refinement-request-capture`: Capture files now include `response` and `timing` alongside existing `body`, `inspection`, `cost`
- `refinement-cost-simulation`: Output tokens sourced from real response in local/live instead of hardcoded 0
- `refinement-auto-loop`: Auto loop runs all three modes before analysis; `--eval-mode` replaced by always running all modes; configurable model per mode; two runs in local/live

## Impact

- `refinement/proxy.ts`: TransformStream tee for response capture, timing instrumentation, response parsing
- `refinement/types.ts`: New `ResponseCapture`, `RequestTiming`, `ExpectedBehavior` types; extended `InspectionRecord`; extended scenario YAML schema
- `refinement/runner.ts`: Multi-mode collection flow, model flag, two-run logic, aggregation
- `refinement/engine-runner.ts`: Fixture seeding, prompt-based execution for local/live
- `refinement/scenarios/*.yaml`: Add `prompt:`, `expected_behavior:`, `fixtures:` to all scenarios
- `refinement/assertions.ts`: New behavioral assertions (`must_call`, `must_not_call`, `max_rounds`, `must_complete`)
- New directory `refinement/fixtures/` with per-scenario project files
