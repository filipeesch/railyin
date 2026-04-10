## Context

The refinement harness was built as a 3-layer testing system (mock → local → live) to validate AI chat interactions without spending on the Anthropic API. The mock layer (layer 1) was designed to be the fastest and cheapest — $0, instant. However, the current implementation has a fundamental flaw: `runner.ts` bypasses the engine entirely in mock mode, sending handcrafted requests with `tools: []` to the proxy. This means every tool-related assertion is meaningless, and the infrastructure tests only the proxy's SSE generation plumbing.

Real conversation data from the database shows expensive patterns:
- spawn_agent cold starts costing $0.36–0.40 each (60K+ token cache writes)
- Sub-agent cache prefix mismatches causing duplicate cold starts
- Parallel sub-agents racing and missing cache hits

The existing files involved:
- `refinement/proxy.ts` — HTTP proxy, request inspection, mock SSE generation
- `refinement/runner.ts` — CLI orchestrator, mock scenario execution, report generation
- `refinement/engine-runner.ts` — Headless engine integration for local/live modes
- `refinement/types.ts` — Shared types
- `refinement/assertions.ts` — Assertion evaluators
- `refinement/scenarios/*.yaml` — 4 scenario files

## Goals / Non-Goals

**Goals:**
- Mock mode exercises the real engine (tool resolution, system prompt assembly, spawn_agent handling)
- Every proxied request is captured with full body to disk for token analysis
- Cost estimation simulates Anthropic pricing from request body token estimates
- Scenarios reflect real conversation patterns observed in the database
- The refine skill can analyze captured requests and recommend optimizations

**Non-Goals:**
- Changing the production engine code (engine.ts, anthropic.ts, tools.ts)
- Making mock mode bit-for-bit identical to real Anthropic responses
- Token counting with the actual Anthropic tokenizer (char/4 approximation is sufficient)
- Supporting non-Anthropic provider pricing

## Decisions

### 1. Unify mock and local/live code paths

**Decision**: Mock mode uses `engine-runner.ts` (same as local/live). The only difference is the proxy returns scripted SSE instead of forwarding.

**Why**: The current separate `runMockScenario()` in runner.ts sends `tools: []` and `system: "Test scenario"` — it doesn't exercise the code we want to test. Routing through the engine means `resolveToolsForColumn()`, `assembleMessages()`, `adaptTools()`, and `runSubExecution()` all run for real.

**Alternative considered**: Inject a tool list into scenario YAML for mock runner to send. Rejected because it still skips the engine's tool resolution logic and system prompt assembly — the most valuable things to test.

### 2. Scenario YAML specifies column config, not raw tools

**Decision**: Scenarios declare a `column_tools` array (using the same group names as workflow YAML). The engine-runner creates a workflow config with these tools for the scenario's column.

```yaml
name: explore-spawn-read
column_tools: [read, search, web, interactions, agents]
```

**Why**: This tests the real `resolveToolsForColumn()` expansion path. If a tool group is misconfigured, the scenario catches it. It also means scenarios mirror how the production workflow YAML works.

**Alternative considered**: Use the real `delivery.yaml` or `openspec.yaml` workflow. Rejected because scenarios should be self-contained and not break when workflow config changes.

### 3. Token estimation via `JSON.stringify().length / 4`

**Decision**: Estimate tokens from the serialized JSON of each component (tools, system, messages) divided by 4.

**Why**: The actual Anthropic tokenizer is a Python/Rust library not available in Bun. The `/4` ratio approximates well for English text and JSON (~3.5–4.5 chars per token). For cost comparison between strategies, relative accuracy matters more than absolute — and this ratio is consistent.

**Cost formula** (matching `logUsage()` in anthropic.ts):
```
input:       tokens × $3.00 / 1M
cache_write: tokens × $6.00 / 1M
cache_read:  tokens × $0.30 / 1M  
output:      tokens × $15.00 / 1M
```

### 4. Cache simulation: prefix = tools + system, delta = messages

**Decision**: The proxy classifies tokens into cache regions based on request structure:
- **Prefix** (cacheable): tools array + system blocks — stable across turns
- **Delta** (not cached): messages array — grows each turn
- On cache MISS: prefix tokens → `cache_write`, delta tokens → `input`
- On cache HIT: prefix tokens → `cache_read`, delta tokens → `input`

**Why**: This matches Anthropic's actual cache behavior. The `prefixKey` (tools_hash + system_hash) already tracks prefix identity. Token estimation per component gives the split.

### 5. Raw request capture to per-request JSON files

**Decision**: The proxy stores the full parsed request body in state. The runner writes each request as a numbered JSON file in the report directory:

```
refinement/reports/<timestamp>-mock/
  report.json                  ← summary, metrics, costs, assertions
  requests/
    001.json                   ← full request body + inspection + cost estimate
    002.json
    ...
```

**Why**: Full request bodies enable:
- Token-level analysis (which tool schema is most expensive)
- Snapshot-based regression detection (diff request files across runs)
- AI-assisted review in the refine skill (read files, recommend optimizations)

**Size**: Typical request body is 5–100KB. A 10-request scenario produces ~500KB. Reports are .gitignored.

### 6. Per-request cost breakdown in InspectionRecord

**Decision**: Extend `InspectionRecord` with:

```typescript
interface CostEstimate {
  tools_tokens: number;
  system_tokens: number;
  messages_tokens: number;
  output_tokens: number;
  input_cost: number;
  cache_write_cost: number;
  cache_read_cost: number;
  output_cost: number;
  total_cost: number;
}
```

**Why**: Cost lives alongside inspection data — one record per request, one cost estimate per record. The runner aggregates into scenario totals and computes cache savings vs all-cold baseline.

### 7. Scenario design based on real database patterns

**Decision**: Replace the 4 existing hypothetical scenarios with scenarios derived from real conversation data:

| Scenario | Source pattern | What it tests |
|---|---|---|
| `single-agent-multi-turn` | Task 12 explore flow | Cache prefix stability across turns, tool schema matching |
| `spawn-agent-cache-sharing` | Task 1 exec (logs 3506–3514) | parentToolDefs sharing, sub-agent gets parent's tools_hash |
| `spawn-agent-tool-whitelist` | Task 1 msg 1266 (child tools ≠ parent) | Tool whitelist enforcement, error on blocked tool |
| `multi-spawn-exploration` | Task 22 (4 sequential spawn_agent rounds) | Progressive cache warming, cost accumulation |
| `tool-schema-validation` | file-tool-optimizations change | tools_exclude, tools_count after tool removal |

**Why**: Real patterns expose real issues. The exec-96 pattern where parallel sub-agents all cold-start at $0.36 each is exactly the kind of thing scenarios should catch.

## Risks / Trade-offs

- **[Token estimation ±20% accuracy]** → Acceptable for strategy comparison. If absolute accuracy becomes needed, can swap in tiktoken via Bun FFI later.
- **[Report disk usage with full bodies]** → ~500KB per scenario run. Reports are .gitignored. Can add `--slim` flag later to omit raw bodies.
- **[Engine-runner setup complexity]** → Creating in-memory DB + temp workflow config adds ~50ms startup per scenario. Negligible for mock mode.
- **[Mock SSE responses don't match real model behavior]** → By design. Mock tests the request shape (what the engine sends), not the response quality (what the model returns). Local/live modes cover response behavior.
- **[Scenario maintenance when tool groups change]** → Scenarios declare `column_tools` using group names. When `TOOL_GROUPS` changes, scenarios naturally pick up the new tool set. Only `tools_count` assertions need updating.
