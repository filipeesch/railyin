# /refine Skill

**Trigger:** `/refine` or `/opsx:refine`

**Description:** Automate the implement → measure → evaluate → iterate loop for an OpenSpec change.
Runs scenarios before, during (after each task group), and after implementation to catch regressions early.

**When to use:** Before spending real API tokens — implement a change locally, validate it with mock/local
model scenarios, then optionally promote to live Anthropic runs.

## Instructions

Read this skill in full before starting. Do not truncate.

### Input

Accepts: `/refine --change <name> --mode <mock|local|live>`

- `--change` — the OpenSpec change name (required; infer from conversation if unambiguous)
- `--mode` — testing layer (default: `mock`)
  - `mock` — scripted scenarios, $0, no model needed
  - `local` — LM Studio with Qwen 3.5, $0, requires local GPU
  - `live` — real Anthropic API, ~$0.80 per before/after pair

### Workflow

#### Step 0 — Announce and validate

Print:
```
## Refinement: <change> | mode: <mode>
```

Check `openspec status --change <name> --json`. If tasks are not present, abort with a message.

#### Step 1 — Baseline measurement

Run all scenarios to get a baseline before touching any code:
```bash
bun refinement/runner.ts --mode <mode> [-- --backend <url>]
```

Save the output path. This is the **baseline report**.

If the baseline runner fails to start (e.g., proxy port in use), report the error and stop.

Print a summary table:

```
### Baseline
| Scenario            | Pass | cache_hit_ratio | tools_count |
| ------------------- | ---- | --------------- | ----------- |
| edit-file-flow      | ✅   | 0.00            | 3           |
```

#### Step 2 — Implement task groups (loop)

Read `openspec/changes/<name>/tasks.md`. Identify task groups (## headings).

For each uncompleted group:

1. **Implement** all tasks in the group (mark `- [ ]` → `- [x]` as each completes)
2. **Run tests**: `bun test src/bun/test --timeout 20000`
3. **Run scenarios**: `bun refinement/runner.ts --mode <mode> --compare <baseline-report>`
4. **Show checkpoint**:

```
### Checkpoint: Group N — <description>
Δ cache_hit_ratio: 0.00 → 0.75 (improved)
Tests: 373 pass
✅ No regressions
```

5. If regression detected (runner exits non-zero or comparison shows worsening): **stop**, show:

```
## Paused — Regression in Group N
Metric worsened: <metric>: <before> → <after>
Options:
1. Revert this group and try an alternative approach
2. Accept and continue (not recommended)
3. Update scenario assertions to match new expected behavior
```

Then wait for user direction.

#### Step 3 — Layer promotion

After all groups pass on current mode:

```
## All groups pass on mode: mock
Ready to promote to local mode?
- Requires LM Studio with Qwen 3.5 loaded
- Runs behavioral validation, not just structural
Type /refine --change <name> --mode local to promote
```

If `--mode local` is confirmed:
1. Run `lms server start` (no-op if already running)
2. Run `lms load qwen3.5:9b --gpu=max --context-length=32768`
3. Verify with `lms ps` — model should appear
4. Re-run all scenarios with `--mode local --backend http://localhost:1234`
5. On completion: `lms unload --all`

If `--mode live` is confirmed:
- Run with real Anthropic API — use sparingly
- Report real cache tokens and cost from `message_start` SSE usage

### LM Studio lifecycle (local mode only)

```bash
# Start server
lms daemon up && lms server start

# Load model
lms load qwen3.5:9b --gpu=max --context-length=32768

# Verify
lms ps

# Run scenarios
bun refinement/runner.ts --mode local

# Cleanup
lms unload --all
```

If `lms` is not found, report: "LM Studio CLI not found. Install from https://lmstudio.ai and ensure `lms` is in PATH."

### Notes

- Keep code changes minimal per group — easier to bisect regressions
- If a scenario assertion is too strict for the current state, update the scenario YAML
  rather than disabling the assertion
- Reports are written to `refinement/reports/<timestamp>-<mode>/` (git-ignored) — reference `report.json` when comparing
- Use `--scenario <name>` to run only one scenario during debugging

### Cost Analysis Workflow

Every run now produces per-request JSON captures alongside the report:

```
refinement/reports/<timestamp>-mock/
  report.json                          ← summary with cost fields
  requests/
    <scenario-name>/
      001.json                         ← full request body + inspection + cost
      002.json
      ...
```

#### Reading per-request captures

Each `NNN.json` file contains:
- `body` — the full Anthropic POST body (tools array, system blocks, messages)
- `inspection` — `InspectionRecord` with `tools_names`, `tools_hash`, `cost`, `label`, `model`
- `cost` — `CostEstimate`: `tools_tokens`, `system_tokens`, `messages_tokens`, `output_tokens`, `total_cost`

Use these to answer questions like:
- "Which tool schema contributes the most tokens to the prefix?"
  → Compare `inspection.cost.tools_tokens` across requests; read `body.tools` to see which are largest
- "Is the system prompt growing between turns?"
  → Check `inspection.cost.system_tokens` across requests; stable = good cache prefix
- "Did sub-agents share the parent's tools hash?"
  → Compare `inspection.tools_hash` for records where `inspection.label != "parent"`
- "What are the real token counts vs estimated?"
  → Compare `inspection.cost.*_tokens` vs actual numbers from live mode SSE `usage` field

#### Cost fields in report.json

`ScenarioReport` and `RunReport` both include:
- `total_cost` — actual estimated cost (with cache hits credited)
- `all_cold_cost` — what it would cost if every request was a cold start
- `cache_savings` — `all_cold_cost - total_cost`
- `cache_savings_pct` — savings as a percentage

A healthy multi-turn scenario should show 30–90% cache savings after warm-up.

#### Interpreting the console output

```
  Cost breakdown:
    req 1 [parent] claude-3-5-sonnet-20241022: 12480T prefix (cache_write) + 320T delta = $0.0748
    req 2 [parent] claude-3-5-sonnet-20241022: 12480T prefix (cache_read) + 512T delta = $0.0053
    req 3 [parent] claude-3-5-sonnet-20241022: 12480T prefix (cache_read) + 784T delta = $0.0056
  Scenario total: $0.0857 | cold: $0.2336 | savings: $0.1479 (63%)
```

- First request is always `cache_write` (cold start) — expect higher cost
- Subsequent requests should be `cache_read` — 20x cheaper prefix cost
- Sub-agent requests labeled with their `x-agent-label` (e.g., `[Agent 1/2]`)
- If sub-agents show `cache_write` when you expect `cache_read`, the tools_hash changed

#### Scenario column_tools configuration

Scenarios declare which tool groups to load via `column_tools`:
```yaml
column_tools:
  - read
  - write
  - search
  - agents
```

Available groups: `read`, `write`, `search`, `web`, `shell`, `interactions`, `agents`, `lsp`

If omitted, defaults to `[read, write, search, shell, interactions, agents]`.

