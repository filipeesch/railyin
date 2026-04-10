# /refine Skill

**Trigger:** `/refine` or `/opsx:refine`

**Description:** Autonomous engine improvement loop. Runs scenarios, analyzes captures, fetches Anthropic docs, generates findings, applies changes, and verifies improvements — repeating for N configurable iterations.

**When to use:** When you want to autonomously improve the Railyin conversation engine (tool descriptions, caching strategy, system prompt efficiency, behavioral quality) without manual intervention.

## Instructions

Read this skill in full before starting. Do not truncate.

### Input

```
/refine [--providers <ids>] [--scenarios <names>] [--max-rounds N]
```

- `--providers` — comma-separated provider IDs from `config/providers.yaml`. Defaults to `behavioral_provider` from providers.yaml.
- `--scenarios` — comma-separated scenario names to run (default: all).
- `--max-rounds N` — stop after N improvement iterations (default: unlimited).

**Providers always run in series, never in parallel.** The runner iterates through the comma-separated list sequentially — each provider completes all its scenarios before the next one starts. This is intentional: local GPU models require exclusive VRAM access. Never run two provider invocations concurrently from separate terminals.

## Loop

### Phase 1 — Baseline

```bash
bun refinement/runner.ts --mode auto --phase baseline --providers <ids> [--scenarios <names>]
```

This writes:
- `reports/<timestamp>-auto/baseline-report.json` — run result
- `reports/<timestamp>-auto/capture-summary.json` — per-scenario token averages + capture paths
- Prints `report-dir:` to stdout

Save the printed `report-dir` path — all subsequent commands use it.

### Phase 2 — Generate findings

Read `capture-summary.json` from the report dir. For each `scenario.capture_paths`, read individual `NNN.json` files to inspect:
- `inspection.cost.tools_tokens` — token cost of the tools array
- `inspection.cost.system_tokens` — token cost of system blocks
- `body.tools` — full tool definitions with descriptions and input schemas
- `inspection.cache_hit` — whether prefix cache was hit
- `inspection.tools_hash` — hash of the tools array (stable = good)

**Before generating ANY finding, consult the knowledge base and Anthropic docs:**

1. **Read the knowledge base first.** Check `knowledge/` files for existing guidance on the topic (tool descriptions, prompt caching, cost model, etc.). The knowledge base contains verified Anthropic doc quotes and Free Code reference patterns. If the knowledge base already covers your finding's topic, use its guidance directly.

2. **If the knowledge base doesn't cover the topic**, follow the research prompt at `.github/prompts/research-provider-best-practices.prompt.md` — it contains the exact sources (Anthropic doc URLs, Free Code paths) and step-by-step process. Update the relevant `knowledge/` file with your findings before proceeding.

3. Copy the exact passage verbatim into `doc_quote`. Do NOT paraphrase or fabricate. If you cannot find a supporting passage, **drop the finding** — it means it has no doc backing.
4. If the docs contradict your finding (e.g., docs say "detailed descriptions are critical" but your finding trims them), **do not create the finding**.

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
- `doc_quote` must be copied verbatim from the fetched page — never paraphrased, never fabricated
- If the docs contradict the finding, the finding must be dropped; never create a finding that conflicts with Anthropic's own guidance
- `metric_contract.expected_after` must be strictly better than `before`
- One finding = one targeted change; don't bundle multiple files in one finding
- Supported metrics: `total_cost`, `tools_tokens`, `cache_hit_ratio`, `cache_savings_pct`
- Finding categories: `token_waste`, `cache_break`, `schema_gap`, `behavioral`

### Phase 3 — Apply/verify loop

For each finding in `findings.json` with `status: "pending"`:

**3a. Backup + mark applied:**
```bash
bun refinement/runner.ts --mode auto --phase backup \
  --finding-id F001 --findings <report-dir>/findings.json --report-dir <report-dir>
```
This saves the original file to `backups/F001/` and sets `status: "applied"` in findings.json.

**3b. Apply the code change** — edit the source file per `change.description`.

If you discover a bug while applying or evaluating a finding, fix it properly:

1. Identify the root cause — not the symptom.
2. Edit the source file with a correct, complete fix.
3. Run the relevant tests to confirm the fix holds.
4. Only then continue to the next finding.

No workarounds. No `// TODO`. No deferring to a future finding. No masking the symptom. A bug that is found must be fixed, not remediated.

**3c. Evaluate:**
```bash
bun refinement/runner.ts --mode auto --phase evaluate \
  --finding-id F001 --findings <report-dir>/findings.json --report-dir <report-dir> \
  --providers <ids>
```
Exits with:
- `0` — finding confirmed or ineffective; continue to next
- `2` — finding rolled back (metric didn't improve or assertion regressed); files restored

The runner writes `findings-report.json` immediately after each finding resolves.

**Stopping conditions** (runner handles these automatically):
- All findings are processed (no more pending)
- Last 3 rounds each show < 1% improvement in `total_cost`
- `--max-rounds N` limit is reached (add flag to evaluate calls)

### Reading the findings report

`<report-dir>/findings-report.json` contains:
- `findings[]` — all findings with final status (`confirmed` / `rolled_back` / `ineffective`)
- `rounds[]` — per-round cost progression
- `summary.improvement_pct` — total cost reduction from baseline

A confirmed finding is safe to keep.

## Quality Assessment

After the baseline and after each evaluate phase, score **what the model actually did** for each scenario (0–10). This is separate from structural assertions.

**What to assess:**
1. **Task completion** — does the worktree diff match what the prompt asked for?
2. **Code quality** — correct, idiomatic, complete? Or skeleton/pseudo-code?
3. **Tool efficiency** — reasonable call sequences, or excessive exploration loops without writing?

**Scoring rubric:**

| Score | Meaning |
|-------|---------|
| 9–10 | Task fully completed, correct implementation, efficient tool use |
| 7–8 | Task completed, minor issues (missing edge case, one wrong file path) |
| 5–6 | Partial — core logic present but significant gaps |
| 3–4 | Major structural failures (wrong files, wrong pattern) |
| 0–2 | Model explored and gave up, or produced no actionable output |

**Print a quality block after each run:**

```
### Quality Assessment — <scenario> / <provider>
Score: 7/10
Task completion: Model implemented the handler but missed registration in tools index.
Code quality: Idiomatic, correct parameter validation, matches existing patterns.
Tool efficiency: 6 read rounds before first write — acceptable for a new file scenario.
Gaps: Missing export in src/bun/handlers/index.ts
Next: Add must_call: [edit_file] assertion to surface the gap explicitly.
```

## Captures

Every run produces per-request JSON captures at:
```
reports/<timestamp>-auto/<provider-id>/<scenario-name>/NNN.json
```

Each file contains:
- `body` — full Anthropic POST body (tools array, system blocks, messages)
- `inspection.cost.tools_tokens` — token cost of the tools array
- `inspection.cost.system_tokens` — token cost of system blocks
- `inspection.cache_hit` — whether prefix cache was hit
- `inspection.tools_hash` — hash of the tools array (stable = good)

`report.json` includes per-scenario:
- `total_cost` — actual estimated cost (with cache hits credited)
- `all_cold_cost` — cost if every request was cold
- `cache_savings_pct` — savings percentage

