## 1. AnthropicProvider base_url Fix

- [x] 1.1 Pass `config.base_url` instead of `undefined` to `AnthropicProvider` in `instantiateProvider()` (`src/bun/ai/index.ts`)
- [x] 1.2 Add test: provider config with `base_url` creates AnthropicProvider using that URL
- [x] 1.3 Add test: provider config without `base_url` creates AnthropicProvider with default `https://api.anthropic.com`

## 2. Proxy Core

- [x] 2.1 Create `refinement/proxy.ts` with `Bun.serve` HTTP server accepting `POST /v1/messages`
- [x] 2.2 Parse CLI flags: `--mode` (mock/local/live), `--port` (default 8999), `--backend` (override URL)
- [x] 2.3 Implement request forwarding to backend in local and live modes (unmodified body, pass headers)
- [x] 2.4 Implement SSE passthrough: stream backend response events directly to caller in local/live modes
- [x] 2.5 Add default backend URLs per mode: mock → none, local → `http://localhost:1234`, live → `https://api.anthropic.com`

## 3. Request Inspector

- [x] 3.1 Parse incoming JSON body and extract `tools`, `system`, `messages`, `max_tokens`, `cache_control`
- [x] 3.2 Compute `tools_hash` as SHA256 of sorted (by name) tool definitions JSON
- [x] 3.3 Compute `system_hash` as SHA256 of system content JSON
- [x] 3.4 Build inspection record: `request_id`, `tools_count`, `tools_hash`, `system_hash`, `cache_control_present`, `max_tokens`, `message_count`, `timestamp`
- [x] 3.5 Log structured inspection record for every request

## 4. Cache Simulator

- [x] 4.1 Maintain a rolling map of `{ tools_hash + system_hash → last_seen_request_id }` per execution context
- [x] 4.2 Classify requests as cache HIT (matching hash) or MISS (new/different hash)
- [x] 4.3 Log cache classification per request with hash values
- [x] 4.4 Inject synthetic `cache_read_input_tokens` / `cache_creation_input_tokens` into `message_start` SSE usage for mock and local modes

## 5. Mock Mode SSE Response Generator

- [x] 5.1 Read the active scenario's script array and maintain a turn counter
- [x] 5.2 Generate valid Anthropic SSE stream for `respond_with: tool_use` entries (content_block_start, content_block_delta with input_json_delta, message_delta with stop_reason: tool_use)
- [x] 5.3 Generate valid Anthropic SSE stream for `respond_with: text` entries (content_block_start, content_block_delta with text_delta, message_delta with stop_reason: end_turn)
- [x] 5.4 Generate `message_start` event with model info and synthetic usage stats
- [x] 5.5 Return a simple text completion when script is exhausted or no scenario is loaded

## 6. Scenario YAML Format

- [x] 6.1 Create `refinement/scenarios/` directory
- [x] 6.2 Implement YAML scenario parser: load file, validate required fields (`name`, `description`, `assertions`)
- [x] 6.3 Parse optional `script` array with `role: user` / `respond_with: tool_use|text` entries
- [x] 6.4 Parse optional `modes` filter array; default to all modes if absent
- [x] 6.5 Reject scenario files missing required fields with descriptive error messages

## 7. Assertion Framework

- [x] 7.1 Implement `cache_prefix_stable` assertion: all requests have the same tools_hash as the first request
- [x] 7.2 Implement `tools_include` assertion: specified tool names are present in request tools
- [x] 7.3 Implement `tools_exclude` assertion: specified tool names are absent from request tools
- [x] 7.4 Implement `max_tokens_initial` assertion: first request's max_tokens matches expected value
- [x] 7.5 Implement `tool_result_max_chars` assertion: a specific tool's result does not exceed given character limit
- [x] 7.6 Implement `tools_count` assertion: total number of tools matches expected count
- [x] 7.7 Each assertion returns `{ pass: boolean, message: string }` with details on failure

## 8. Scenario Definitions

- [x] 8.1 Create `edit-file-flow.yaml`: multi-turn edit scenario with read_file → edit_file → verify, asserting cache_prefix_stable and tools_include
- [x] 8.2 Create `sub-agent-cache.yaml`: parent and sub-agent with different tool sets, asserting cache_prefix_stable fails (detecting the exec 96 bug)
- [x] 8.3 Create `tool-removal.yaml`: scenario asserting tools_exclude for removed/unnecessary tools
- [x] 8.4 Create `search-and-edit.yaml`: grep → read → edit flow, asserting tools_count and max_tokens_initial

## 9. Runner CLI

- [x] 9.1 Create `refinement/runner.ts` with CLI argument parsing: `--mode`, `--port`, `--backend`, `--scenario`, `--compare`
- [x] 9.2 Implement run lifecycle: start proxy → load scenarios (filter by mode) → execute sequentially → collect records
- [x] 9.3 Evaluate assertions against collected inspection records after each scenario
- [x] 9.4 Generate JSON report to `refinement/reports/<timestamp>-<mode>.json` with per-scenario results and aggregated metrics
- [x] 9.5 Implement `--compare <path>` flag: load baseline report, diff each metric, determine improved/regressed/unchanged
- [x] 9.6 Exit with non-zero code when any assertion fails or comparison detects regression

## 10. Headless Engine Integration

- [x] 10.1 Import the engine module in the runner for local and live mode scenario execution
- [x] 10.2 Configure engine to use proxy endpoint (`http://localhost:<port>`) as the provider base_url
- [x] 10.3 Execute scenario user prompts programmatically through the engine, collecting tool calls and responses
- [x] 10.4 Feed engine output back into assertion evaluation alongside proxy inspection records

## 11. Copilot Skill and Prompt

- [x] 11.1 Create `.github/skills/refine/SKILL.md` with skill description, triggers, and instructions
- [x] 11.2 Create `.github/prompts/refine.prompt.md` with the `/refine` command accepting `--change` and `--mode` flags
- [x] 11.3 Implement baseline measurement step: run scenarios before any implementation and save as baseline report
- [x] 11.4 Implement group-level checkpoint loop: for each task group, implement → run tests → run scenarios → compare → report
- [x] 11.5 Implement regression stop: halt and report when any metric regresses versus baseline
- [x] 11.6 Implement layer promotion prompt: suggest mock → local → live after all groups pass, switch mode on confirmation
- [x] 11.7 Implement LM Studio lifecycle management: `lms server start`, `lms load`, `lms ps`, `lms unload --all` for local mode

## 12. Project Configuration

- [x] 12.1 Add `refine:mock`, `refine:local`, `refine:live` scripts to `package.json`
- [x] 12.2 Add `refinement/reports/` to `.gitignore`
- [x] 12.3 Verify `js-yaml` is available as a dependency (already expected); add if missing
