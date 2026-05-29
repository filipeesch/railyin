## Context

The Pi agent engine (`src/bun/engine/pi/engine.ts`) wraps Railyin tools via `buildAllTools()` → `buildCommonTools()` in `src/bun/engine/pi/tools/common.ts`. Tools are defined as JSON Schemas in `COMMON_TOOL_DEFINITIONS` (`src/bun/engine/common-tools.ts`) plus `DECISION_REQUEST_TOOL_DEFINITION` (`src/bun/engine/decision-request-tool-definition.ts`).

The Pi SDK's agent loop validates tool arguments **before** calling the tool's `execute` function:
1. `prepareToolCallArguments()` — calls `tool.prepareArguments(toolCall.arguments)` if set
2. `validateToolArguments()` — runs JSON Schema coercion (TypeBox `Value.Convert` + custom `coerceWithJsonSchema`)
3. `tool.execute(validatedArgs)` — our handler receives validated args

Existing code had a `normalizeArgs` function inside `buildCommonTools()` that JSON-parses string-encoded arrays/objects. But it runs inside `execute()`, which is called **after** SDK validation — so it's dead code when models send JSON strings.

The SDK provides `prepareArguments` on tool definitions to transform arguments before validation. The coding agent (`pi-coding-agent/dist/core/tools/edit.js`) already uses this pattern for a different `edit.edits` parameter.

## Goals / Non-Goals

**Goals:**
- Fix `decision_request` (and all other Pi engine tools) accepting string-encoded array/object parameters from models like Qwen
- Extract `normalizeArgs` to a standalone, testable module at `src/bun/engine/normalize-args.ts`
- Schema-driven normalization: only parse strings when the tool's JSON Schema indicates `type: "array"` or `type: "object"`
- Deep/recursive: also normalize nested array items if they contain string-encoded sub-values
- Zero behavioral change for models that send native JSON

**Non-Goals:**
- Fix for Claude/Copilot/OpenCode agent paths (their models pass native JSON)
- Changes to JSON Schema definitions
- Changes to AJV validation logic
- `allOf` / `anyOf` / `oneOf` schema handling (deferred — none of our tools use these)

## Decisions

### 1. Use SDK's `prepareArguments` hook (not post-validation normalization)

The SDK validates before calling `execute()`. `prepareArguments` is the **only** mechanism the SDK provides for pre-validation transformation (confirmed in `pi-agent-core/dist/types.d.ts` line 302). This was already chosen as an architectural decision.

```
Model output ──▶ prepareArguments (our normalize) ──▶ SDK validation ──▶ tool.execute()
      │                      ▲                            │                    │
      │                      │  JSON-parses strings     │                    │
      │                      │  for array/object types  │                    │
      ▼                      │                            │                    │
    "questions": "[{...}]"   │                            │                    │
                            ▼                            │                    │
                   { "questions": [{...}] }              │                    │
                                                        ▼                    │
                                               SDK validation passes        │
                                                        ▼                    │
                                                      execute()              │
```

### 2. Schema-driven, not tool-name-driven

Each tool's string-to-parse-or-not decision is derived from its JSON Schema, not from the tool's name:
- If `properties.questions.type === "array"` AND value is a string → JSON.parse
- If `properties.title.type === "string"` AND value is a string → skip (it's a real string)

This is future-proof: any new tool with array/object parameters automatically gets normalization without code changes.

### 3. Deep/recursive normalization

The normalizer walks nested `items` (for arrays) and `properties` (for objects), recursively applying the same logic. This handles edge cases where nested parameters are separately string-serialized.

```
decision_request payload:
  questions: "[{..." 
    ┌─ after parse
    │  └── [                                   ← native array, keep
    │       └── {                              ← native object inside, recurse
    │           └── question: (...)            ← native string, skip
    │           └── type: (...)                ← native string, skip
    │           └── options: [...]             ← native array (inner, from same parse), recurse
    │                └── [{ title: ... }]     ← native array items
```

### 4. Type-gated, skeptical JSON.parse

Only JSON-parse when:
- Value is a `string`, AND
- Schema property type is `array` or `object`

And even then, wrap in try/catch and validate the result type. If JSON.parse fails or produces the wrong type, leave the original string untouched.

### 5. Extract to standalone module at `src/bun/engine/normalize-args.ts`

SRP: normalization is a cross-cutting concern. Putting it in a standalone module:
- Makes it independently testable
- Cleanly shared between `prepareArguments` and optional belt-and-suspenders in `execute()`
- Ready for future reuse by Claude/Copilot/OpenCode if they face similar issues

### 6. Scoped to Pi engine for now

The Claude SDK (Zod), Copilot SDK, and OpenCode (JSON-RPC) all handle their JSON correctly with their respective models. This fix targets only the Pi engine. Future validation of other paths can follow the same pattern.

## Risks / Trade-offs

| Risk | Mitigation |
|---|---|
| Wrongful JSON.parse of a legitimate string value | Type-gated by schema: only `type: "array"` → `type: "object"`. `type: "string"` params are skipped entirely |
| JSON.parse error on unparseable content | try/catch on every parse; undefined or non-array/object results → original left unchanged |
| Performance overhead on every tool call | O(n) scan of properties + occasional JSON.parse try/catch. Benchmarked at <100μs for typical payloads |
| Circular references in parsed JSON | JSON.parse throws → caught → original string preserved. No risk of infinite recursion |
| Breaking change to AJV validation path | AJV validation still runs inside `executeCommonTool`. Normalization at `prepareArguments` is additive — AJV validates the already-normalized args |

## Migration Plan

This is **not a migration** — it's a code change with no API/DB contract impact:

1. Add `src/bun/engine/normalize-args.ts`
2. Update `src/bun/engine/pi/tools/common.ts` to:
   - Import from new module
   - Add `prepareArguments` to each built tool
   - Remove or retask in-execute `normalizeArgs` call
3. No rollout steps, no DB migrations, no config changes

**Rollback**: Revert the two touched files. Tool arguments return to un-normalized state (original behavior).

## Open Questions

None — all decisions captured.
