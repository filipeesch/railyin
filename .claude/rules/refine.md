---
description: Autonomous engine improvement loop — runs scenarios, generates findings from captured data + Anthropic docs, applies changes, verifies improvements, repeats N times.
---

Run the autonomous refinement loop to improve the Railyin conversation engine.

**Input**: `/refine [--providers <ids>] [--scenarios <names>] [--max-rounds N]`

- `--providers` — comma-separated provider IDs from `config/providers.yaml`
- `--scenarios` — comma-separated scenario names (default: all)
- `--max-rounds N` — stop after N improvement iterations (default: unlimited)

Read the full skill at `.github/skills/refine/SKILL.md` before proceeding.

Key commands:
- Baseline: `bun refinement/runner.ts --mode auto --phase baseline --providers <ids>`
- Backup: `bun refinement/runner.ts --mode auto --phase backup --finding-id <id> --findings <path> --report-dir <dir>`
- Evaluate: `bun refinement/runner.ts --mode auto --phase evaluate --finding-id <id> --findings <path> --report-dir <dir> --providers <ids>`
- Behavioral gate: `bun refinement/runner.ts --mode auto --phase behavioral --findings <path> --report-dir <dir>`

