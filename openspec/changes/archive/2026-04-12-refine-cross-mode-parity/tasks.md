## 1. Types and Interfaces

- [x] 1.1 Add `ResponseCapture` type to `refinement/types.ts` with `stop_reason`, `content_blocks`, `usage`, `model` fields
- [x] 1.2 Add `RequestTiming` type to `refinement/types.ts` with `request_received_at`, `first_byte_at`, `last_byte_at`, `ttfb_ms`, `duration_ms`
- [x] 1.3 Add `ExpectedBehavior` type to `refinement/types.ts` with `must_call`, `must_not_call`, `max_rounds`, `must_complete`, `ideal_rounds`, `ideal_tool_sequence`
- [x] 1.4 Extend `Scenario` type to include `prompt`, `expected_behavior`, and `fixtures` fields; remove `modes` field
- [x] 1.5 Extend `InspectionRecord` to include `response: ResponseCapture` and `timing: RequestTiming`
- [x] 1.6 Add `model` field to `RunReport` and `ScenarioReport`
- [x] 1.7 Remove `--eval-mode` from ProxyMode / runner argument parsing

## 2. Streaming Response Capture in Proxy

- [x] 2.1 Refactor live mode passthrough in `proxy.ts` to use TransformStream (same as local mode) instead of raw body forwarding
- [x] 2.2 Add chunk accumulator (`chunks: string[]`) to the TransformStream loop for both local and live modes
- [x] 2.3 Implement `parseSseResponse(accumulated: string): ResponseCapture` — extract content blocks, stop_reason, usage from SSE events
- [x] 2.4 Synthesize `ResponseCapture` from mock script entries in mock mode
- [x] 2.5 After stream end, patch `InspectionRecord.cost.output_tokens` and recalculate `output_cost` / `total_cost` from real response for local/live
- [x] 2.6 Store `ResponseCapture` in `state.rawRequests` (rename to `rawExchanges`) alongside request body

## 3. Per-Request Timing

- [x] 3.1 Record `request_received_at = Date.now()` at top of `handleRequest`
- [x] 3.2 Record `first_byte_at` on first chunk in TransformStream for local/live; set equal to `request_received_at` for mock
- [x] 3.3 Record `last_byte_at` when stream reader reports done; set equal to `request_received_at` for mock
- [x] 3.4 Compute `ttfb_ms` and `duration_ms` derived fields
- [x] 3.5 Attach `RequestTiming` to each `InspectionRecord`
- [x] 3.6 Write timing data into per-request capture JSON files

## 4. Scenario Parity

- [x] 4.1 Add `prompt:` field to `tool-schema-validation.yaml` with a real task prompt
- [x] 4.2 Add `prompt:` field to `single-agent-multi-turn.yaml` with a real task prompt
- [x] 4.3 Add `prompt:` and `expected_behavior:` to `multi-spawn-exploration.yaml`; remove `modes: [mock]`
- [x] 4.4 Add `prompt:` and `expected_behavior:` to `spawn-agent-cache-sharing.yaml`; remove `modes: [mock]`
- [x] 4.5 Add `prompt:` and `expected_behavior:` to `spawn-agent-tool-whitelist.yaml`; remove `modes: [mock]`
- [x] 4.6 Add `expected_behavior:` to `tool-schema-validation.yaml` and `single-agent-multi-turn.yaml`
- [x] 4.7 Remove `modes:` field handling from `loadAllScenarios()` in `scenarios.ts`

## 5. Scenario Fixtures

- [x] 5.1 Create `refinement/fixtures/basic-typescript/` with `tsconfig.json`, `src/config.ts`, `src/main.ts`, `package.json`
- [x] 5.2 Create `refinement/fixtures/multi-module/` with multiple TS modules for search/explore tasks
- [x] 5.3 Add `fixtures:` field to each scenario YAML referencing the appropriate fixture directory
- [x] 5.4 Update `engine-runner.ts` to copy fixture directory into temp git repo when `scenario.fixtures` is set and mode is local/live

## 6. Engine Runner: Prompt-Based Execution

- [x] 6.1 Update `runScenarioThroughEngine` to use `scenario.prompt` when mode is local or live instead of extracting user messages from `script:`
- [x] 6.2 Implement two-run logic: run each scenario twice in local/live, store under `run-1/` and `run-2/` subdirectories
- [x] 6.3 Aggregate two-run results: compute avg, variance, min, max for rounds, timing, and tool counts

## 7. Behavioral Assertions

- [x] 7.1 Implement `must_call` assertion: check that all specified tools appear in the tool names collected from the run
- [x] 7.2 Implement `must_not_call` assertion: check that none of the specified tools appear in tool names
- [x] 7.3 Implement `max_rounds` assertion: check that total request count does not exceed the limit
- [x] 7.4 Implement `must_complete` assertion: check that the last response has `stop_reason: "end_turn"`
- [x] 7.5 Collect soft metrics (`ideal_rounds`, `ideal_tool_sequence`) into a behavioral report without failing assertions
- [x] 7.6 Update `evaluateAssertions` in `assertions.ts` to run behavioral assertions for local/live mode runs

## 8. Multi-Mode Collection Pipeline

- [x] 8.1 Refactor `runAutoLoop()` in `runner.ts` to sequentially collect mock, local, and live baselines
- [x] 8.2 Add `--local-model` and `--live-model` CLI flags; auto-detect local model from `lms ps`
- [x] 8.3 Add `--skip-live` flag (default for cost safety)
- [x] 8.4 Skip local/live gracefully when backend is unavailable (no model loaded, no API key)
- [x] 8.5 Organize report directory as `<timestamp>-auto/mock/`, `local/`, `live/` subdirectories
- [x] 8.6 Store model name in `RunReport` and `ScenarioReport`

## 9. Cross-Mode Analysis

- [x] 9.1 Implement `generateAnalysis()` that reads mock, local, and live reports and produces `analysis.json`
- [x] 9.2 Include token cost comparison (mock estimated vs live real output tokens)
- [x] 9.3 Include tool sequence comparison across models (local vs live)
- [x] 9.4 Include round trip comparison and timing summary
- [x] 9.5 Include completion rates and variance flags
- [x] 9.6 Write `analysis.json` to the auto report directory

## 10. Re-Collection After Finding Application

- [x] 10.1 Update finding evaluate phase to re-run all available modes (not just one) after applying a finding
- [x] 10.2 Confirm finding only if mock metric improves AND local/live assertions don't regress
- [x] 10.3 Update `evaluateMetricContract` to accept multi-mode reports

## 11. Cleanup and Deprecation

- [x] 11.1 Remove `--eval-mode` flag and parsing from `runner.ts`; print error if user passes it
- [x] 11.2 Remove scenario `modes:` filtering from `loadAllScenarios()` in `scenarios.ts`
- [x] 11.3 Update `capture-summary.json` generation to include timing and response metadata
- [x] 11.4 Update `refine.prompt.md` to reflect new multi-mode auto loop flow
