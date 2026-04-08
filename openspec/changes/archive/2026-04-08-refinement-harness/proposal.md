## Why

Validating AI workflow changes (tool schemas, cache behavior, result formatting) currently requires running against the real Anthropic API at ~$0.30–3.00 per execution. This makes iterative optimization expensive and slow. We need a local testing harness that can validate structural correctness ($0), behavioral quality (local model, $0), and finally real API behavior (targeted, ~$0.80) — a three-layer refinement loop automated by a Copilot skill.

## What Changes

- Add a **refinement proxy** (`refinement/proxy.ts`) — a thin Bun.serve HTTP server that intercepts Anthropic Messages API requests, inspects them (tools hash, system hash, cache_control presence, max_tokens), simulates cache prefix behavior, and forwards to a configurable backend
- Add a **cache simulator** that tracks SHA256(system + tools) across requests in an execution, detects prefix matches/mismatches between parent and sub-agent calls, and injects synthetic `cache_read_input_tokens` / `cache_creation_input_tokens` into usage responses
- Add a **scenario player** for mock mode that reads YAML scenario files and returns scripted Anthropic SSE responses (tool_use blocks, text, usage stats) without any model
- Add a **scenario runner** CLI (`refinement/runner.ts`) that orchestrates: start proxy → run scenarios → collect metrics → generate report JSON
- Add **YAML scenario definitions** (`refinement/scenarios/`) — declarative test cases with assertions about tool sets, cache stability, result sizes, and max_tokens values
- Add a **report comparison** system that diffs metrics between baseline and iteration runs, producing pass/fail per assertion
- **Forward `base_url` to AnthropicProvider** — currently `instantiateProvider()` passes `undefined` for `baseUrl`, always hitting `api.anthropic.com`. This one-line fix enables pointing at localhost for all three layers
- Add a **Copilot skill** (`/refine`) that automates the full implement → measure → evaluate → iterate loop: picks tasks from an OpenSpec change, implements a group, runs scenarios, compares metrics, and continues or reverts based on results
- Add `package.json` scripts: `refine:mock`, `refine:local`, `refine:live`

## Capabilities

### New Capabilities
- `refinement-proxy`: Transparent HTTP proxy for Anthropic Messages API with request inspection, cache simulation, and three backend modes (mock/local/live)
- `refinement-scenarios`: YAML-based scenario definitions with scripted responses, assertions, and metrics collection for validating AI workflow behavior
- `refinement-runner`: CLI orchestrator that runs scenarios across layers, collects reports, and compares metrics between runs
- `refinement-skill`: Copilot skill that drives the automated implement → measure → evaluate → iterate loop with deep checkpoints

### Modified Capabilities
- `anthropic-provider`: Forward `base_url` from provider config to `AnthropicProvider` constructor (currently hardcoded to `undefined`)

## Impact

- **New folder**: `refinement/` (top-level, permanent infrastructure — not shipped with app)
- **New folder**: `.github/skills/refine/` and `.github/prompts/refine.prompt.md`
- **Modified file**: `src/bun/ai/index.ts` — pass `config.base_url` to `AnthropicProvider` (1 line)
- **Dependencies**: None new — uses Bun.serve, crypto (built-in), js-yaml (already a dependency)
- **External tools**: LM Studio (`lms` CLI) for Layer 2 — not a code dependency, just used by the skill at runtime
- **Config**: Workspace `providers` section with `base_url` for `anthropic` type (already supported in schema, just not forwarded)
