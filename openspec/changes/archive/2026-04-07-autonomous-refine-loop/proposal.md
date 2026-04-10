## Why

The `/refine` skill today is a human-guided loop: the developer runs scenarios, reads output, decides what to fix, edits code, and compares manually. This puts the entire analytical burden on the human and limits how often the loop runs. We want the AI to do the observation, analysis, fix, and verification cycle autonomously — running until it reaches a plateau or hits a stopping condition — with the developer reviewing a findings report at the end rather than driving each iteration.

## What Changes

- **New `--mode auto` flag** on `bun refinement/runner.ts` — runs the full autonomous loop (structural + behavioral phases) and emits a `findings-report.json`
- **Finding generation step** — after each run, analyze `requests/NNN.json` captures against known signals (cache breaks, token waste, schema gaps) and produce a structured `Finding[]` list
- **Per-finding doc search** — for each finding, use `search_internet` + `fetch_url` to locate the relevant Anthropic documentation and ground the proposed fix in official guidance
- **Apply/verify/rollback cycle** — apply one finding at a time, re-run scenarios with `--compare`, commit if metrics improve, rollback if they worsen or any assertion regresses
- **Behavioral gate** — after structural improvements stabilize in mock mode, run once in local mode (if available) to verify no behavioral regressions
- **Findings report** — written to `reports/<timestamp>-auto/findings-report.json` with each finding's status (`confirmed`, `rolled_back`, `ineffective`), its doc source, and metric delta
- **Updated SKILL.md** — rework the `/refine` skill instructions to document the autonomous workflow and how to interpret findings reports

## Capabilities

### New Capabilities

- `refinement-findings`: Structured finding format, generation logic from captures, per-finding metric contract, and status lifecycle (pending → applied → confirmed/rolled-back/ineffective)
- `refinement-auto-loop`: The autonomous apply/verify/rollback orchestration loop, stopping conditions (plateau detection, behavioral gate), and findings report output

### Modified Capabilities

- `refinement-cost-simulation`: The cost simulation spec gains a note that cost fields are inputs to the auto-loop's improvement metric
- `refinement-request-capture`: Request captures are now the primary input to finding generation, not just debugging artifacts

## Impact

- `refinement/runner.ts` — new `--mode auto` path and loop orchestration
- `refinement/types.ts` — new `Finding` interface and `FindingsReport` type
- `.github/skills/refine/SKILL.md` — complete rewrite to document the autonomous workflow
- `.github/prompts/refine.prompt.md` — update quick-reference for new commands and report structure
- No changes to main app code (`src/bun/`) — the loop analyzes and improves app code but that's runtime behavior, not a structural change to the harness contract
