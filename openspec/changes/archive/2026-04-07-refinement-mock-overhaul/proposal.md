## Why

The refinement harness mock layer (layer 1) currently bypasses the engine entirely — `runner.ts` crafts fake requests with `tools: []` and `system: "Test scenario"`. This means mock mode tests nothing meaningful: tool resolution, system prompt assembly, spawn_agent handling, and cache prefix behavior are all skipped. The proxy dutifully records empty data. Real conversations from the database show that spawn_agent cold starts cost $0.36–$0.40 each, and sub-agent cache prefix mismatches silently waste money. The mock layer should be the fastest and cheapest way to catch these issues, but right now it can't.

## What Changes

- **Route mock mode through the engine**: Mock scenarios use the same `engine-runner.ts` path as local/live modes. The engine calls `resolveToolsForColumn()`, `assembleMessages()`, and `retryStream()` — the proxy returns scripted SSE responses instead of forwarding to a backend. This means every request the proxy sees contains real tools, real system blocks, and real messages.
- **Capture raw request bodies in reports**: The proxy stores the full `POST /v1/messages` body (tools, system, messages, max_tokens, model) for every request to disk. Reports include per-request JSON files alongside the summary, enabling deep token efficiency analysis and snapshot-based regression detection.
- **Simulate Anthropic costs from request bodies**: The proxy estimates token counts from the request JSON (`JSON.stringify(component).length / 4`) and applies Sonnet 4.6 pricing (input=$3/MTok, cache_write=$6/MTok, cache_read=$0.30/MTok, output=$15/MTok). Each request gets a cost breakdown; the scenario report shows totals and cache savings vs an all-cold baseline.
- **New scenarios based on real conversation patterns**: Replace the current hypothetical scenarios with ones derived from actual database conversations — single-agent multi-turn, spawn_agent with parentContext sharing, spawn_agent tool whitelist enforcement, and multi-spawn exploration flows.

## Capabilities

### New Capabilities
- `refinement-cost-simulation`: Token estimation and Anthropic cost calculation from raw request bodies in the proxy, with per-request and per-scenario cost breakdowns in reports.
- `refinement-request-capture`: Full request body capture to disk for every proxied API call, enabling token efficiency analysis and snapshot regression testing.

### Modified Capabilities
- `spawn-agent`: Scenarios will exercise and assert on spawn_agent's parentContext/parentToolDefs passing, tool whitelist enforcement, and cache prefix sharing behavior.

## Impact

- `refinement/proxy.ts` — Replace hardcoded synthetic usage with token estimation; add raw body capture to state
- `refinement/runner.ts` — Route mock mode through engine-runner; write per-request JSON files to report directory; aggregate cost metrics
- `refinement/types.ts` — Extend InspectionRecord with cost fields, tool names, token estimates; add CostEstimate type
- `refinement/engine-runner.ts` — Add column tools configuration to `setupEngineConfig()`; support scenario-defined workflow config
- `refinement/assertions.ts` — Add new assertion types: `tools_hash_stable`, `sub_agent_gets_parent_tools`, `cost_under`
- `refinement/scenarios/*.yaml` — Rewrite scenarios to reflect real conversation patterns from the database
- `.github/skills/refine/SKILL.md` — Update skill to reference cost analysis workflow
