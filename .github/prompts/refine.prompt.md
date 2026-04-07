---
description: Automate the implement → measure → evaluate → iterate loop for an OpenSpec change using the refinement harness (mock / local model / live Anthropic).
---

Refine an OpenSpec change using the local testing harness.

**Input**: `/refine --change <name> --mode <mock|local|live>`
- `--change` — OpenSpec change name (required; infer from context if unambiguous)
- `--mode` — testing layer: `mock` (default, $0), `local` ($0, needs LM Studio), `live` (~$0.80)

Read the full skill instructions at `.github/skills/refine/SKILL.md` before proceeding.
Follow the workflow exactly: baseline → implement groups → checkpoint after each group → promote.

Key commands:
- Baseline: `bun refinement/runner.ts --mode <mode>`
- After group: `bun refinement/runner.ts --mode <mode> --compare <baseline-dir>/report.json`
- Single scenario: `bun refinement/runner.ts --mode mock --scenario <name>`
- Tests: `bun test src/bun/test --timeout 20000`
- LM Studio start: `lms daemon up && lms server start && lms load qwen3.5:9b --gpu=max --context-length=32768`
- LM Studio stop: `lms unload --all`

Report structure: `refinement/reports/<timestamp>-<mode>/report.json` + `requests/<scenario>/NNN.json`
- Per-request JSON captures contain full body + inspection + cost estimate
- Use captures to analyze token efficiency (tools_tokens, system_tokens, messages_tokens)
- Cost fields: total_cost, all_cold_cost, cache_savings, cache_savings_pct
