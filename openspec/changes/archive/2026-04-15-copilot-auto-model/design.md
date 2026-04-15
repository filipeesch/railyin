## Context

Copilot execution already behaves as "auto" when no model is pinned because the session config omits `model` if no resolved model exists. However, the model list and selection pipeline are built around non-null qualified model IDs, so users cannot explicitly choose Auto in the UI. The change is cross-cutting across engine metadata, RPC payloads, enabled-model filtering, and task model selection rendering.

Constraints:
- Preserve existing behavior for non-Copilot engines.
- Keep Auto persistence as `task.model = null` (no new sentinel string).
- Keep enabled-model curation for concrete models while ensuring Auto is always selectable.

## Goals / Non-Goals

**Goals:**
- Provide a first option `Auto` in Copilot model lists.
- Define Auto identity as `qualifiedId: null` and propagate safely through typed model payloads.
- Show clear user-facing description of Copilot-managed model choice.
- Ensure selecting Auto results in omitted model in Copilot SDK session config.

**Non-Goals:**
- Introducing heuristic model routing in Railyin itself.
- Changing native or Claude engine model-list semantics.
- Adding new DB tables or migration for Auto-specific persistence.

## Decisions

1. Use nullable model identity for Auto
- Decision: extend model metadata types to allow `qualifiedId: string | null` where model list payloads are produced/consumed.
- Rationale: matches actual persistence/engine semantics (`task.model = null` means no pinned model), avoids synthetic IDs and special parsing.
- Alternative considered: `copilot/auto` sentinel string. Rejected because it leaks UI concept into persistence and execution normalization.

2. Inject Auto as a synthetic Copilot model-list entry at index 0
- Decision: prepend Auto in Copilot engine `listModels()` output.
- Rationale: guarantees stable UX ordering and avoids relying on SDK-provided ordering.
- Alternative considered: inject Auto in UI only. Rejected because backend list APIs and filtering still need coherent model identity handling.

3. Keep Auto always available independent of enabled_models table
- Decision: enabled-model filtering applies only to concrete model IDs; Auto bypasses enabled list checks.
- Rationale: Auto is a control mode, not a concrete model entitlement, and should not disappear when users disable all concrete models.
- Alternative considered: store Auto in enabled_models. Rejected due to null identity and unnecessary DB coupling.

4. Keep execution behavior unchanged for Auto
- Decision: when task model is null, Copilot engine continues omitting `model` from session config.
- Rationale: aligns with current implementation and SDK contract; minimal risk.
- Alternative considered: map null to explicit default model before execution. Rejected because it defeats Auto intent.

## Risks / Trade-offs

- [Nullable model IDs ripple through shared types] -> Mitigation: update RPC/model interfaces and exhaustively type-check model list transforms.
- [UI assumptions about non-null option values may break selection state] -> Mitigation: update selector binding to accept null value and add regression tests.
- [Enabled-model filtering logic may accidentally drop Auto] -> Mitigation: add explicit branch for Auto in listEnabled pipeline and test empty-enabled scenarios.
- [Potential confusion about what Auto does] -> Mitigation: include clear description text in Auto option and docs/spec language.

## Migration Plan

- No schema migration required.
- Rollout is backward-compatible: existing tasks with concrete model strings continue to work; null models gain explicit UI representation as Auto.
- Rollback strategy: remove synthetic Auto entry and restore strict string typing; persisted task models remain valid.

## Open Questions

- Should Auto be shown only for Copilot, or generalized later for other engines with provider-side routing?
- Should workflow column YAML eventually support explicit `model: auto` token, or keep absence/null as the only Auto representation?
