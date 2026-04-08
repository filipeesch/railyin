# /refine Skill

**Trigger:** `/refine` or `/opsx:refine`

**Description:** Automate the implement → measure → evaluate → iterate loop for an OpenSpec change.
Runs scenarios before, during (after each task group), and after implementation to catch regressions early.

**When to use:** Before spending real API tokens — implement a change locally, validate it with mock/local
model scenarios, then optionally promote to live Anthropic runs.

## Instructions

Read this skill in full before starting. Do not truncate.

### Input

Accepts: `/refine --change <name> --mode <mock|local|live|auto>` (legacy) or `/refine --change <name> --providers <ids>`

- `--change` — the OpenSpec change name (required; infer from conversation if unambiguous)
- `--mode` — testing layer (default: `mock`; legacy; prefer `--providers` when providers.yaml is configured)
  - `mock` — scripted scenarios, $0, no model needed
  - `local` — LM Studio with Qwen 3.5, $0, requires local GPU
  - `live` — real Anthropic API, ~$0.80 per before/after pair
  - `auto` — autonomous finding → apply → verify loop
- `--providers` — comma-separated provider IDs from `config/providers.yaml` (e.g. `mock-default` or `lmstudio-qwen,anthropic-sonnet`)
- `--scenarios` — comma-separated scenario names to run (default: all)
- `--max-rounds N` — (auto mode only) stop after N finding iterations (default: unlimited)

### Autonomous Loop Mode (--mode auto / --providers)

Use `--mode auto` (or `--providers` with a mock provider) when you want to optimize AI call efficiency without manual round-trips.

**Provider-based invocation** (preferred when `config/providers.yaml` is configured):
```bash
# Run all default providers
bun refinement/runner.ts --providers mock-default

# Run specific providers + scenarios
bun refinement/runner.ts --providers lmstudio-qwen,anthropic-sonnet --scenarios export-markdown,new-tool

# Provider-based auto loop
bun refinement/runner.ts --mode auto --providers lmstudio-qwen
```

**Legacy mode invocation** (fallback when no providers.yaml):
```bash
bun refinement/runner.ts --mode mock
bun refinement/runner.ts --mode local --local-model lmstudio/qwen2.5-coder
```

The behavioral gate uses the `behavioral_provider` from providers.yaml (first lmstudio provider if not set), or falls back to `lms ps` detection.

#### Phase 1 — Baseline (structural)

```bash
# Provider-based (preferred):
bun refinement/runner.ts --mode auto --phase baseline --providers lmstudio-qwen

# Legacy mock ($0):
bun refinement/runner.ts --mode auto --phase baseline

# Legacy local (LM Studio, $0, real model):
bun refinement/runner.ts --mode auto --phase baseline --local-model lmstudio/qwen2.5-coder

# Legacy live (Anthropic API, ~$0.10 for 2 scenarios):
bun refinement/runner.ts --mode auto --phase baseline --live-model anthropic/claude-3-5-sonnet-20241022
```

This writes:
- `reports/<timestamp>-auto/baseline-report.json` — run result
- `reports/<timestamp>-auto/capture-summary.json` — per-scenario token averages + capture paths
- Prints `report-dir:` and next steps

Report dir suffix: `<ts>-auto` for mock, `<ts>-auto-local` for local, `<ts>-auto-live` for live.

Save the printed `report-dir` path — all subsequent commands use it.

#### Phase 2 — Finding generation

Read `capture-summary.json` from the report dir. For each `scenario.capture_paths`, read individual `NNN.json` files to inspect:
- `inspection.cost.tools_tokens` — token cost of the tools array
- `inspection.cost.system_tokens` — token cost of system blocks
- `body.tools` — full tool definitions with descriptions and input schemas
- `inspection.cache_hit` — whether prefix cache was hit
- `inspection.tools_hash` — hash of the tools array (stable = good)

For each finding, perform a targeted doc search:
```
search_internet("anthropic docs <topic>")
fetch_url(<most relevant result>)
```

Then emit a `findings.json` file at `<report-dir>/findings.json` with `Finding[]`:

```json
[
  {
    "id": "F001",
    "category": "token_waste",
    "source": { "file": "src/bun/ai/anthropic.ts", "line": 42, "symbol": "buildTools" },
    "evidence": {
      "current_tokens": 2840,
      "estimated_after": 1900,
      "savings_per_request": 940,
      "doc_reference": "https://docs.anthropic.com/en/docs/build-with-claude/tool-use/implement-tool-use",
      "doc_quote": "Descriptions should be concise but complete..."
    },
    "metric_contract": {
      "metric": "total_cost",
      "before": 0.0124,
      "expected_after": 0.0095
    },
    "change": {
      "type": "edit",
      "description": "Trim verbose parameter descriptions in read_file tool to < 60 chars each"
    },
    "status": "pending"
  }
]
```

Rules:
- `doc_reference` is required — skip findings without a valid docs.anthropic.com URL
- `metric_contract.expected_after` must be strictly better than `before`
- One finding = one targeted change; don't bundle multiple files in one finding
- Supported metrics: `total_cost`, `tools_tokens`, `cache_hit_ratio`, `cache_savings_pct`
- Finding categories: `token_waste`, `cache_break`, `schema_gap`, `behavioral`

#### Phase 3 — Apply/verify loop (one finding at a time)

For each finding in `findings.json` with `status: "pending"`:

**3a. Backup + mark applied:**
```bash
bun refinement/runner.ts --mode auto --phase backup \
  --finding-id F001 --findings <report-dir>/findings.json --report-dir <report-dir>
```
This saves the original file to `backups/F001/` and sets `status: "applied"` in findings.json.

**3b. Apply the code change** — edit the source file per `change.description`.

**3c. Evaluate:**
```bash
# mock (default):
bun refinement/runner.ts --mode auto --phase evaluate \
  --finding-id F001 --findings <report-dir>/findings.json --report-dir <report-dir>

# local — add --local-model matching the baseline:
bun refinement/runner.ts --mode auto --phase evaluate \
  --finding-id F001 --findings <report-dir>/findings.json --report-dir <report-dir> \
  --local-model lmstudio/qwen2.5-coder

# live:
bun refinement/runner.ts --mode auto --phase evaluate \
  --finding-id F001 --findings <report-dir>/findings.json --report-dir <report-dir> \
  --live-model anthropic/claude-3-5-sonnet-20241022
```
Exits with:
- `0` — finding confirmed or ineffective; continue to next
- `2` — finding rolled back (metric didn't improve or assertion regressed); files restored

The runner writes `findings-report.json` immediately after each finding resolves.

**Stopping conditions** (runner handles these automatically):
- All findings are processed (no more pending)
- Last 3 rounds each show < 1% improvement in `total_cost`
- `--max-rounds N` limit is reached (add flag to evaluate calls)

#### Phase 4 — Behavioral gate (optional)

After the loop completes, if LM Studio is available:
```bash
bun refinement/runner.ts --mode auto --phase behavioral \
  --findings <report-dir>/findings.json --report-dir <report-dir>
```

This runs all scenarios in local mode and checks for assertion regressions. Updates `findings-report.json` with `behavioral_gate: "passed" | "failed" | "skipped"`. Skipped automatically if no local model is loaded.

#### Reading the findings report

`<report-dir>/findings-report.json` contains:
- `findings[]` — all findings with final status (confirmed/rolled_back/ineffective)
- `rounds[]` — per-round cost progression
- `summary.improvement_pct` — total cost reduction from baseline
- `summary.behavioral_gate` — gate result or "skipped"

A confirmed finding with `behavioral_validated: true` is safe to keep. `behavioral_validated: false` means the structural improvement exists but behavioral validation failed — consider reviewing that finding manually.

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
    <provider-id>/                     ← present when --providers flag was used
      <scenario-name>/
        001.json                       ← full request body + inspection + cost
        002.json
        ...
    <scenario-name>/                   ← legacy path (--mode flag, no provider nesting)
      001.json
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

