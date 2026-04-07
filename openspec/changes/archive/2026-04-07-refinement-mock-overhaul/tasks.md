## 1. Types and Data Model

- [x] 1.1 Add `CostEstimate` interface to `refinement/types.ts` with fields: tools_tokens, system_tokens, messages_tokens, output_tokens, input_cost, cache_write_cost, cache_read_cost, output_cost, total_cost
- [x] 1.2 Extend `InspectionRecord` in `refinement/types.ts` with: `tools_names: string[]`, `cost: CostEstimate`, `label: string`, `model: string`
- [x] 1.3 Add `rawRequests: Array<{ request_id: number; body: unknown }>` to `ProxyState` in `refinement/proxy.ts`
- [x] 1.4 Add `column_tools` optional field to `Scenario` type in `refinement/types.ts`
- [x] 1.5 Add cost aggregation fields to `ScenarioReport` in `refinement/types.ts`: `total_cost`, `all_cold_cost`, `cache_savings`, `cache_savings_pct`

## 2. Token Estimation and Cost Calculation

- [x] 2.1 Create `estimateTokens(body)` function in `refinement/proxy.ts` that returns `{ tools_tokens, system_tokens, messages_tokens }` using `JSON.stringify(component).length / 4`
- [x] 2.2 Create `estimateCost(tokens, cacheHit, outputTokens)` function in `refinement/proxy.ts` that applies Sonnet pricing: input=$3/MTok, cache_write=$6/MTok, cache_read=$0.30/MTok, output=$15/MTok
- [x] 2.3 Create `estimateOutputTokens(entry)` function in `refinement/proxy.ts` for mock mode: tool_use = `ceil(JSON.stringify(entry.input).length / 4) + 20`, text = `ceil(entry.content.length / 4)`
- [x] 2.4 Wire `estimateTokens` + `estimateCost` into `handleRequest()` — populate `record.cost`, `record.tools_names`, `record.label`, `record.model`
- [x] 2.5 Replace hardcoded `syntheticUsage` with values derived from `estimateTokens` and cache hit/miss classification

## 3. Raw Request Capture

- [x] 3.1 Store parsed request body in `state.rawRequests` array inside `handleRequest()` alongside existing `state.records`
- [x] 3.2 Add request labeling logic: extract `x-agent-label` header if present, else default to `"parent"`
- [x] 3.3 In `runner.ts`, after scenario completes, write per-request JSON files to `reports/<timestamp>-<mode>/requests/NNN.json` containing body + inspection + cost
- [x] 3.4 Update `resetState()` in proxy to also clear `rawRequests`

## 4. Route Mock Mode Through Engine

- [x] 4.1 Remove the standalone `runMockScenario()` function from `runner.ts`
- [x] 4.2 Update the `run()` function in `runner.ts` so mock mode calls `runScenarioThroughEngine()` (same as local/live)
- [x] 4.3 Update `setupEngineConfig()` in `engine-runner.ts` to accept a `columnTools` parameter and write it into the temporary workflow YAML
- [x] 4.4 Update `runScenarioThroughEngine()` to read `scenario.column_tools` and pass it to `setupEngineConfig()`
- [x] 4.5 Set default `column_tools` to `[read, write, search, shell, interactions, agents]` when scenario doesn't specify it
- [x] 4.6 Add `x-agent-label` header injection in AnthropicProvider or engine for sub-agent requests (so proxy can capture the label)

## 5. Report Enhancements

- [x] 5.1 Add per-scenario cost summary to `ScenarioReport`: aggregate `total_cost` from all request costs
- [x] 5.2 Compute `all_cold_cost` by re-running cost calculation treating every request as a cache miss
- [x] 5.3 Compute `cache_savings = all_cold_cost - total_cost` and `cache_savings_pct`
- [x] 5.4 Print cost summary to console during run: per-request line with label, tokens, cost, cache status
- [x] 5.5 Print scenario total with cache savings at end of each scenario
- [x] 5.6 Include cost data in the `report.json` file at both scenario and run level

## 6. Scenarios

- [x] 6.1 Rewrite `edit-file-flow.yaml` → `single-agent-multi-turn.yaml`: column_tools=[read, write, search], 3-turn read→edit→verify flow, asserts cache_prefix_stable + tools_count + cost breakdown
- [x] 6.2 Rewrite `sub-agent-cache.yaml` → `spawn-agent-cache-sharing.yaml`: column_tools=[read, write, search, shell, interactions, agents], script triggers spawn_agent with 2 children, asserts tools_hash matches parent + cost shows cache hits on sub-agents
- [x] 6.3 Rewrite `tool-removal.yaml` → `tool-schema-validation.yaml`: column_tools=[read, write, search, web, shell, interactions, agents, lsp], asserts tools_exclude=[list_dir, delete_file, rename_file] + tools_count matches expected
- [x] 6.4 Create `spawn-agent-tool-whitelist.yaml`: script triggers spawn_agent where child declares tools=[read_file] but parentToolDefs includes all, script makes model call edit_file (not in child's list) → assert tool_result contains error
- [x] 6.5 Rewrite `search-and-edit.yaml` → `multi-spawn-exploration.yaml`: column_tools=[read, search, web, interactions, agents], multi-round parent with 2 sequential spawn_agent calls, asserts progressive cache warming + total cost
- [x] 6.6 Update `refinement/scenarios.ts` to parse `column_tools` from YAML and validate against known group names

## 7. Assertions

- [x] 7.1 Add `tools_hash_stable` assertion: all requests in a scenario share the same tools_hash (stricter than cache_prefix_stable which only checks tools_hash)
- [x] 7.2 Add `sub_agent_gets_parent_tools` assertion: sub-agent requests (label != "parent") have the same tools_hash as the parent request
- [x] 7.3 Add `cost_under` assertion with a `value` parameter: total scenario cost must be under the given dollar amount
- [x] 7.4 Update `evaluateAssertions()` to handle new assertion types using the enriched InspectionRecord fields
- [x] 7.5 Update `tools_include` and `tools_exclude` assertions to use `record.tools_names` instead of requiring `extras`

## 8. Skill and Documentation

- [x] 8.1 Update `.github/skills/refine/SKILL.md` to document cost analysis workflow and how to interpret per-request captures
- [x] 8.2 Update `.github/prompts/refine.prompt.md` with cost-related commands and report reading guidance

## 9. Tests and Validation

- [x] 9.1 Run `bun test` to verify no regressions from type changes
- [x] 9.2 Run `bun refinement/runner.ts --mode mock` end-to-end and verify: all scenarios produce per-request JSON files, cost breakdowns are non-zero, tools_names are populated
- [x] 9.3 Verify a spawn_agent scenario shows matching tools_hash between parent and sub-agent requests
- [x] 9.4 Verify cost summary output shows cache savings > 0 for multi-turn scenarios
