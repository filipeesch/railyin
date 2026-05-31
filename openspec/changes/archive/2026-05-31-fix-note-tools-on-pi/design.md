## Context

The Pi engine builds its tool surface in two layers:
1. **`customTools`** — the `AgentTool[]` instances passed to `createAgentSession`. These carry execution logic.
2. **`tools` allowlist** — a `string[]` passed to `createAgentSession`. This acts as a global SDK filter; any tool not in the list is silently dropped, even if present in `customTools`.

`buildAllTools()` correctly includes note tools in the `customTools` list via `buildCommonTools()` → `COMMON_TOOL_DEFINITIONS`. However `defaultSessionFactory` maintains the `tools` allowlist as a hardcoded array that was never updated when note tools were added. The same note tools appear in the correct allowlist on session reuse (`setActiveToolsByName`) and in child sessions (`child-session.ts`), because those sites derive the list dynamically from the tools objects rather than a hardcoded string array.

The net effect: note tools fail silently on the **first execution** of any new conversation; they work on subsequent executions (session reuse path).

## Goals / Non-Goals

**Goals:**
- Fix note tool availability on Pi engine first-session creation.
- Eliminate the hardcoded allowlist as a future maintenance surface.
- Make all three allowlist construction sites in the Pi engine consistent and share a single derivation expression.

**Non-Goals:**
- Adding note tools to child/delegate sessions (excluded by design — children are ephemeral executors, not orchestrators).
- Changing how note tools are built or stored in `COMMON_TOOL_DEFINITIONS`.
- Any changes to the Claude, Copilot, or OpenCode engines (they use different tool registration mechanisms that are not affected by this issue).

## Decisions

### Decision: Derive the allowlist dynamically from `piTools`

**Choice**: Replace the hardcoded string array in `defaultSessionFactory` with `[...SDK_BUILTIN_TOOL_NAMES, ...piTools.map(t => t.name)]`.

**Rationale**: The `piTools` array is already fully built by `buildAllTools()` at the call site. Deriving names from it is zero-cost and guarantees exact parity between what's registered and what's allowed. The alternative — appending the three missing names to the hardcoded list — fixes the symptom but preserves the root cause (manual allowlist maintenance).

**Alternatives considered**: Hardcoded patch (rejected — next new common tool repeats the bug); separate note tool names constant (rejected — a constant still diverges from the actual tool set over time).

### Decision: Introduce `buildToolAllowlist()` in `pi/constants.ts`

**Choice**: Extract the allowlist derivation expression into a named helper alongside the existing `SDK_BUILTIN_TOOL_NAMES` constant.

**Rationale**: Three call sites currently construct the allowlist independently. A shared helper makes the derivation the single source of truth, makes diffs reviewable, and prevents future divergence without requiring reviewers to recognise the pattern across files.

**Placement**: `pi/constants.ts` already owns `SDK_BUILTIN_TOOL_NAMES` and is imported by all three call sites. No new module is needed.

## Risks / Trade-offs

- **Risk: Unintentionally allowlisting a future tool that should be restricted** → `buildAllTools()` is the already-trusted source of truth for what the parent agent receives; the allowlist matches it by design. Any intentional restriction should be implemented at the `buildAllTools()` layer, not the allowlist layer.
- **Risk: Child sessions impacted** → Child sessions call a separate `buildChildTools()` path and construct their own `tools` argument in `child-session.ts`. The helper will be applied there too, but it only ever lists what was passed in `tools: AgentTool<any>[]`, so children remain constrained to their intended surface.

## Migration Plan

No data migrations required. Changes are limited to the Pi engine session factory files. Existing sessions are unaffected — they use the reuse path which was already correct. Deployment requires a server restart; no feature flags needed.
