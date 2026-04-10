## Context

The `/refine` skill accumulated two distinct concerns over time:
1. **Change execution** — implementing task groups from an OpenSpec change, running checkpoints, promoting layers
2. **Engine improvement** — running scenarios, finding token inefficiencies, applying targeted fixes, evaluating

These were merged into one skill under the guise of "refine a change". The layer-promotion model (mock → local → live) created complexity without providing clear value once `--providers` gave direct control over which model to test against. The result was a 400-line skill that was hard to follow, mixed responsibilities, and contained many deprecated paths.

The actual engine improvement workflow (Phase 1–4 in auto mode) already existed in the skill but was buried under the change-execution workflow. This change removes the wrapper and keeps only the autonomous loop.

## Goals / Non-Goals

**Goals:**
- Skill and prompt describe only the autonomous improvement loop
- Each phase (baseline, findings, evaluate, behavioral gate) is clearly separated
- `--providers`, `--scenarios`, `--max-rounds` are the only inputs
- Finding schema, quality rubric, and capture structure are preserved

**Non-Goals:**
- Does not change any runner code (`runner.ts`, `proxy.ts`, etc.)
- Does not add new phases or commands — purely a documentation rewrite
- Does not remove the underlying `--mode mock|local|live` runner support (only removes it from the skill documentation)

## Decisions

### Remove change-workflow entirely
**Decision:** Delete all task-group, layer-promotion, LM Studio lifecycle, and OpenSpec change framing from the skill.
**Rationale:** These steps belong to the `openspec-apply-change` skill, not refine. Keeping them here created confusion about when to use each skill. The two concerns are now cleanly separated.

### Keep quality assessment and capture documentation
**Decision:** Retain the 0–10 scoring rubric and the captures section.
**Rationale:** These are directly relevant to the autonomous loop — the agent needs to score behavioral quality after baseline and after each evaluate phase. The capture structure is needed during Phase 2 (findings generation).

### Flatten phase headings (### not ####)
**Decision:** Use `###` for phases, not `####` as the old skill did.
**Rationale:** Phases are top-level concepts in the loop, not sub-steps of a workflow.

## Risks / Trade-offs

- **Loss of change-workflow docs** — Teams relying on the old task-group/layer-promotion workflow via `/refine` will not find those instructions. Mitigation: those workflows live in `openspec-apply-change` skill which is the canonical place.
- **No runner code changes** — Legacy `--mode` flags still work in the runner if needed; they're just not documented in the skill entry point.
