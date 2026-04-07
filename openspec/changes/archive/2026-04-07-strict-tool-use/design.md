## Context

Railyin sends tool definitions to the Anthropic API via `adaptTools()`. Currently the wire format omits `strict: true`, so Anthropic uses its default sampling for tool arguments — Claude may return wrong types or missing fields. We handle this defensively (JSON parse guards, XML-format detection). The Anthropic API now supports `strict: true` (grammar-constrained sampling, GA) which makes argument validation server-side and eliminates those failure modes.

## Goals / Non-Goals

**Goals:**
- Set `strict: true` on every tool definition sent to Anthropic
- Add `additionalProperties: false` to every tool schema (required by strict mode)
- Make this change transparent — no consumer code changes needed

**Non-Goals:**
- Changing OpenAICompatibleProvider (strict mode is Anthropic-specific)
- Restructuring tool definitions or adding new tools
- Removing existing defensive code (that can be done in a follow-up once confirmed working)

## Decisions

### `strict: true` set globally in `adaptTools()`, not per-tool

**Decision:** Add `strict: true` to every tool Anthropic receives, unconditionally.

**Rationale:** All 26 tools have well-defined schemas. There is no case where we want non-strict behavior — the defenses we have today exist precisely because strict mode wasn't available. Opting in globally minimizes diff size and eliminates the possibility of forgetting to enable it on new tools.

**Alternative:** Per-tool opt-in flag in `AIToolDefinition`. Rejected — unnecessary complexity; strict mode is strictly better for all our tools.

### `additionalProperties: false` injected in `adaptTools()`, not in `tools.ts` definitions

**Decision:** `adaptTools()` adds `additionalProperties: false` to each schema at wire-adaptation time rather than requiring each of the 26 tool objects to declare it.

**Rationale:** This is an Anthropic wire constraint, not a semantic property of the tool. Keeping it in the adapter keeps `tools.ts` clean and ensures future tools get it automatically.

**Alternative:** Add it to each object in `tools.ts`. Rejected — noisy, easy to forget on new tools.

## Risks / Trade-offs

- **Strict mode schema validation:** If any tool schema has properties that don't round-trip through JSON Schema correctly (e.g., nested objects with missing `type`), Anthropic may return a 400. Mitigation: run tests against live API in development before deploying; the existing test suite covers `adaptTools()`.
- **No rollback needed:** Strict mode is purely additive. If it causes issues, removing `strict: true` from `adaptTools()` is a one-line revert.
