## Context

The `effort` parameter controls how much thinking Claude applies per request (`"low"`, `"medium"`, `"high"`, `"max"`). It was introduced in Phase 5 of the current sprint as `AICallOptions.effort` and is already used in two places:
- Sub-agents: explicitly passed as `effort: "low"` in `retryTurn()` 
- Parent agent: no effort set → Sonnet 4.6 defaults to `high`

The parent agent currently has no mechanism to configure effort. Users running Railyin for routine tasks (file edits, searches, quick decisions) pay for `high` thinking on every streaming call even when `medium` or `low` would suffice.

Effort config follows the exact same pattern as `cache_ttl` — a workspace-level `anthropic.*` field read at provider initialization and threaded into streaming calls.

## Goals / Non-Goals

**Goals:**
- Add `anthropic.effort` workspace config option
- Apply the configured effort as the default for parent agent `stream()` calls
- Sub-agent `effort: "low"` overrides the config default (explicit always wins)

**Non-Goals:**
- A UI toggle for effort (unlike `enable_thinking`, effort is not exposed via RPC in this change)
- Per-task effort selection
- Effort config for non-Anthropic providers

## Decisions

### Decision: Config field name is `anthropic.effort`
Consistent with `anthropic.enable_thinking` and `anthropic.cache_ttl`. Alternative considered: `anthropic.thinking_effort` — rejected because the parameter name in the API is simply `effort`.

### Decision: Explicit `AICallOptions.effort` always overrides config
Sub-agents pass `effort: "low"` explicitly. The provider reads config only when no explicit effort is provided in `AICallOptions`. This avoids sub-agents accidentally inheriting a `high` config if the workspace sets it.

### Decision: Apply config effort in `src/bun/ai/index.ts`, not in `anthropic.ts`
The provider (`anthropic.ts`) already uses `options.effort` when set. The factory/instantiation layer (`ai/index.ts`) already reads `anthropic.cache_ttl` and `anthropic.enable_thinking` from config and passes them forward. This is the natural place to inject `effort` as well — no change to `anthropic.ts` needed.

## Risks / Trade-offs

- **Risk**: Users set `effort: "low"` and see degraded reasoning quality on complex tasks → Mitigation: document in `workspace.yaml.sample` that `medium` is a good balance; `high` remains the default if unset
- **Risk**: Config typo (e.g. `"hight"`) silently ignored → Mitigation: config schema uses an enum type; invalid values are caught at parse time

## Open Questions

None — pattern is established by `cache_ttl` and `enable_thinking`.
