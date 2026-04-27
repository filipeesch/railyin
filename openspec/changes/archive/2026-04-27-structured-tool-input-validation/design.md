## Context

`executeCommonTool` is the single entry point for all shared MCP tools — it handles 20+ tools used by both the Claude and Copilot engine adapters. Currently it has zero input validation beyond a JSON parse. The only guard is ad-hoc `interview_me` type normalisation added as a patch.

Compounding the problem: both `engine/claude/tools.ts` and `engine/copilot/tools.ts` contain a `toToolArgs()` helper that serialises every SDK-delivered `Record<string, unknown>` value to a string, then every tool handler re-parses (`parseInt`, `JSON.parse`, etc.). This round-trip discards type information exactly where we need it most — at the validation boundary.

AJV is already present on disk (transitive dep via `@modelcontextprotocol/sdk` v8.18.0). `@types/json-schema` provides the `JSONSchema7` type needed to make `AIToolDefinition.parameters` a proper schema object.

## Goals / Non-Goals

**Goals:**
- Generic `validateToolArgs(def, args)` helper driven by the existing `AIToolDefinition.parameters` JSON Schema — single source of truth.
- Clear, model-friendly error messages for invalid enum, missing required, and type mismatch failures.
- Eliminate the `toToolArgs()` round-trip so tool handlers receive properly typed values.
- Add an `enum` to `update_todo_status.status` so it is self-documenting and automatically validated.
- Remove the duplicate code block in `engine/claude/tools.ts`.
- Replace the ad-hoc `interview_me` validation with the generic gate.

**Non-Goals:**
- Validating tool outputs or streaming events.
- Changing tool behaviour beyond input coercion cleanup.
- Adding validation to the native engine's `executeTool` path (out of scope for this change).
- Validating tool args in the Copilot engine beyond the shared `executeCommonTool` entry point.

## Decisions

### D1 — AJV over Zod or custom walker

**Decision:** Use AJV with the existing JSONSchema7 tool definitions as the validation schema.

**Rationale:** The tool definitions already contain valid JSON Schema. AJV is already in the lockfile. Zod would require duplicating the schema in a different DSL. A custom walker would be fragile and hard to extend.

**Alternative considered:** Zod inference from parameters — rejected because it requires maintaining a parallel type representation and adds a Zod compile step.

### D2 — Validate at the top of `executeCommonTool`

**Decision:** The AJV gate runs at the very top of `executeCommonTool`, before any handler dispatch.

**Rationale:** Single chokepoint. Both Claude and Copilot engines call this function; placing validation here means every tool is covered without touching the adapters.

**Alternative considered:** Validate inside each adapter before calling `executeCommonTool` — rejected because it duplicates logic and misses future engine additions.

### D3 — Eliminate `toToolArgs()`, pass `Record<string, unknown>` through

**Decision:** Remove `toToolArgs()` from both adapters. `executeCommonTool` and all downstream handlers accept `Record<string, unknown>`.

**Rationale:** The SDK delivers properly typed JSON. Serialising to strings and re-parsing is accidental complexity that actively prevents validation. Once AJV has validated the schema, handlers can safely cast `args.task_id as number`.

**Alternative considered:** Keep `toToolArgs()`, validate before it — rejected because it leaves the round-trip in place and forces validators to work on pre-stringified values.

### D4 — `AIToolDefinition.parameters` typed as `JSONSchema7`

**Decision:** Add `@types/json-schema` as a devDep and type `parameters` as `JSONSchema7`.

**Rationale:** The runtime objects already contain `enum`, `items`, and nested `properties` — the current narrow type is a lie. `JSONSchema7` is the proper type and enables AJV to accept the schemas directly without casting.

### D5 — Model-friendly error formatting

**Decision:** AJV `errors` array is mapped to human-readable strings before returning to the model. Raw AJV messages are developer-oriented.

Format:
- Enum violation: `"Invalid value '<val>' for '<field>'. Valid values: a, b, c"`
- Missing required: `"Missing required field: '<field>'"`
- Type mismatch: `"Field '<field>' must be <type>, got <actualType>"`

Multiple errors are joined with `\n`.

## Risks / Trade-offs

**[Risk] Handler type casts could mask runtime errors** → Mitigation: AJV validation happens before handlers run; if validation passes, casts are safe. Tests cover each cast path.

**[Risk] AJV version mismatch (transitive vs direct)** → Mitigation: Add `ajv` as a direct dep pinned to the same major version already in the lockfile (v8.x).

**[Risk] Widening handler signatures breaks callers outside `executeCommonTool`** → Mitigation: `board-tools.ts` and `lsp-tools.ts` are only called from `common-tools.ts` — no other callers. The type change is internal.

**[Risk] Existing tests pass stringified args** → Mitigation: Update test helpers in `tasks-tools.test.ts`, `claude-tools.test.ts`, `common-tools-registration.test.ts` to pass typed values; the compiler will catch mismatches.

## Migration Plan

1. Merge `origin/main` (picks up `board-tools.ts` and orchestrator decomposition).
2. Add deps (`ajv`, `@types/json-schema`), run `bun install`.
3. Widen `AIToolDefinition.parameters` to `JSONSchema7`.
4. Create `validate-tool-args.ts` with AJV-backed helper.
5. Remove `toToolArgs()` from both adapters; fix the duplicate block in `claude/tools.ts`.
6. Widen handler signatures in `board-tools.ts`, `lsp-tools.ts`, `common-tools.ts`.
7. Add validation gate to `executeCommonTool`; add `status` enum to `update_todo_status`.
8. Update tests; add new validator test suite.
9. Run `bun test src/bun/test --timeout 20000` — all green.

Rollback: revert the branch. No schema migrations, no data changes.

## Open Questions

None — all design decisions resolved during exploration.
