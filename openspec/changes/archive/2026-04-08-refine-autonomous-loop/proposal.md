## Why

The `/refine` skill was built around an OpenSpec change workflow (task groups, layer promotion, LM Studio lifecycle) that is no longer the primary use case. The skill needs to be refocused as a pure autonomous engine improvement loop: run → analyze → generate findings → apply → evaluate → repeat.

## What Changes

- **BREAKING**: Remove change-name / task-group / layer-promotion workflow from `SKILL.md` and `refine.prompt.md`
- Remove legacy `--mode mock|local|live` instructions from the skill
- Remove LM Studio start/stop lifecycle steps
- Remove Step 0–4 "Implement task groups" workflow framing
- Rewrite `SKILL.md` as a 4-phase autonomous loop: Baseline → Generate findings → Apply/verify loop → Behavioral gate
- Rewrite `refine.prompt.md` to describe only the autonomous loop and its 4 key commands
- Keep: Finding schema (`Finding[]`), Quality Assessment rubric, per-request capture format

## Capabilities

### New Capabilities
<!-- none — this is a documentation/spec update -->

### Modified Capabilities
- `refinement-skill`: Requirements change from change-driven orchestration to autonomous engine improvement loop. Removes task-group, layer-promotion, and LM Studio lifecycle requirements. Adds findings-generation and apply/verify requirements.

## Impact

- `.github/skills/refine/SKILL.md` — rewritten (done)
- `.github/prompts/refine.prompt.md` — rewritten (done)
- `openspec/specs/refinement-skill/spec.md` — needs delta spec update
