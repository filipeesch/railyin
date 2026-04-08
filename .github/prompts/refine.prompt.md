---
description: Automate the implement → measure → evaluate → iterate loop for an OpenSpec change using the refinement harness (mock / local model / live Anthropic / provider-based).
---

Refine an OpenSpec change using the local testing harness.

**Input**: `/refine --change <name> [--providers <ids>] [--scenarios <names>] [--mode <mock|local|live|auto>]`
- `--change` — OpenSpec change name (required; infer from context if unambiguous)
- `--providers` — comma-separated provider IDs from `config/providers.yaml` (preferred when providers.yaml exists)
- `--scenarios` — comma-separated scenario names to run (default: all)
- `--mode` — legacy testing layer: `mock` (default, $0), `local` ($0, needs LM Studio), `live` (~$0.80), `auto` (autonomous multi-mode loop)
- `--max-rounds N` — (auto mode only) cap the number of finding iterations (default: unlimited)

Read the full skill instructions at `.github/skills/refine/SKILL.md` before proceeding.
Follow the workflow exactly: baseline → implement groups → checkpoint after each group → promote.

Key commands:
- Provider-based: `bun refinement/runner.ts --providers mock-default`
- Provider-based (multi): `bun refinement/runner.ts --providers lmstudio-qwen,anthropic-sonnet --scenarios export-markdown`
- Baseline (legacy): `bun refinement/runner.ts --mode <mode>`
- Baseline (local, legacy): `bun refinement/runner.ts --mode local --local-model lmstudio/<id>`
- After group: `bun refinement/runner.ts --mode mock --compare <baseline-dir>/report.json`
- Single scenario (legacy): `bun refinement/runner.ts --mode mock --scenario <name>`
- Tests: `bun test src/bun/test --timeout 20000`
- LM Studio start: `lms daemon up && lms server start && lms load qwen3.5:9b --gpu=max --context-length=32768`
- LM Studio stop: `lms unload --all`

Auto mode commands (--mode auto):
- Baseline (provider-based): `bun refinement/runner.ts --mode auto --phase baseline --providers lmstudio-qwen`
- Baseline (legacy all modes): `bun refinement/runner.ts --mode auto --phase baseline [--local-model <id>] [--live-model <id>] [--skip-live]`
  - Runs mock (1 run), local (2 runs if model available), live (2 runs unless --skip-live)
  - Writes: `<ts>-auto/mock/`, `<ts>-auto/local/`, `<ts>-auto/live/`, `<ts>-auto/analysis.json`
- Backup finding files: `bun refinement/runner.ts --mode auto --phase backup --finding-id F001 --findings <path> --report-dir <dir>`
- Evaluate a finding: `bun refinement/runner.ts --mode auto --phase evaluate --finding-id F001 --findings <path> --report-dir <dir> [--local-model <id>] [--skip-live]`
  - Re-runs all modes that have a baseline; confirms only if mock metric improves AND local/live don't regress
- Behavioral gate: `bun refinement/runner.ts --mode auto --phase behavioral --findings <path> --report-dir <dir>`
  - Uses `behavioral_provider` from providers.yaml (first lmstudio provider if not set), or falls back to `lms ps` detection
- With max rounds: add `--max-rounds N` to any evaluate call

Report structure:
- Provider-based: `refinement/reports/<timestamp>-providers/<provider-id>/report.json` + `requests/<provider-id>/<scenario>/NNN.json`
  - Cross-provider comparison table printed at the end
  - `cost_variance` field in ScenarioReport captures run-to-run cost stddev
- Single mode (legacy): `refinement/reports/<timestamp>-<mode>/report.json` + `requests/<scenario>/NNN.json`
- Auto loop: `refinement/reports/<timestamp>-auto/<provider-id>/` (provider-based) or `mock/`, `local/`, `live/` (legacy)
  - `capture-summary.json` includes: avg_tools_tokens, avg_system_tokens, avg_messages_tokens, avg_ttfb_ms, avg_rounds, completion_rate, model
  - `analysis.json` includes: cross-mode cost ratio, round count delta, tool agreement %, completion rates
- Per-request JSON captures contain full body + inspection + cost + timing
- Cost fields: total_cost, all_cold_cost, cache_savings, cache_savings_pct
- Timing fields (local/live): request_received_at, first_byte_at, last_byte_at, ttfb_ms, duration_ms
- Auto mode writes: `capture-summary.json`, `baseline-report.json`, `findings.json`, `findings-report.json`, `analysis.json`, `backups/<id>/`
