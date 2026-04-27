## Context

The feature change (`structured-tool-input-validation`) rewrites the tool execution path:

1. `toToolArgs()` is removed — args arrive as `Record<string, unknown>` not `Record<string, string>`.
2. A new `validateToolArgs(def, args)` helper runs AJV against each tool's JSON Schema before dispatch.
3. The ad-hoc `interview_me` validation block is deleted — AJV covers it.

Three existing test files call `executeCommonTool` with string-typed args and assert on ad-hoc error messages. After the feature change those tests will fail at the TypeScript layer (type mismatch) or at runtime (wrong error text). They need to be migrated before the test suite is green.

## Goals / Non-Goals

**Goals:**
- Unit-test `validateToolArgs` in isolation (no DB, no context) — enum, required, type, multi-error, and valid-pass-through cases across 4+ tools.
- Migration of all three existing test files to typed args (`number`, `array`, etc.).
- Update error message assertions to match AJV-formatted strings.
- Add new integration scenarios proving the validation gate is wired (invalid arg → early return, valid arg → handler executes).

**Non-Goals:**
- Playwright / e2e tests — validation is purely backend; no UI surface.
- Testing the `jsonSchemaToZodShape` / `ZodLike` path in `claude/tools.ts` — that is already covered by the existing spy tests in `claude-tools.test.ts` and is not changed by this feature.
- Testing AJV internals — we trust AJV; we only test our wrapper and error formatting.

## Decisions

### D1 — Pure unit tests for validateToolArgs, no DI or mocking

**Decision:** `validate-tool-args.test.ts` imports `validateToolArgs` directly and calls it with real tool definitions from `COMMON_TOOL_DEFINITIONS`, `INTERVIEW_ME_TOOL_DEFINITION`, and `LSP_TOOL_DEFINITION`. No mocking.

**Rationale:** The function is pure (`args → string | null`). Mocking AJV or injecting a fake validator would defeat the purpose — we want to verify the real AJV pipeline and our error-formatting logic together. Test helpers should use valid typed args for integration tests, not bypass validation.

**Anti-pattern avoided:** `executeCommonTool("x", args, ctx, validate = validateToolArgs)` — an injectable validator would let tests skip validation, which makes the integration tests meaningless.

### D2 — Broad string matchers for error assertions, not exact strings

**Decision:** Error assertions use `toMatch(/enum-value/)` and `toMatch(/field-name/)` rather than exact `toBe("Invalid value 'X' for 'Y'...")` strings.

**Rationale:** Error message wording may be iterated. The contracts that matter are: (a) the invalid value is named, (b) the valid options are listed, (c) the field name is present. Brittle exact-string assertions would break on minor wording changes.

### D3 — Interview_me empty-questions gap covered by minItems assertion

**Decision:** Add a test case for `questions: []` asserting a validation error. This requires `minItems: 1` to be added to the `interview_me.questions` schema (tracked in the feature change). The test acts as a regression guard.

**Rationale:** The old ad-hoc block explicitly caught empty arrays. Without `minItems: 1` in the schema, AJV silently accepts `[]`. The test pins this behavior.

### D4 — reorganize_todos items migration

**Decision:** Tests for `reorganize_todos` pass `items` as a real array (not `JSON.stringify([...])`). AJV validates `type: "array"` so this passes naturally.

**Rationale:** The old handler had `typeof args.items === "string" ? JSON.parse(args.items) : items` — a `toToolArgs()` artifact. After the refactor, only real arrays are accepted. Tests confirm the new path.

## Risks / Trade-offs

**[Risk] Brittle error message assertions** → Mitigation: Use broad regex matchers (D2 above).

**[Risk] Tests depend on feature change being applied first** → Mitigation: This change depends on `structured-tool-input-validation` being merged first. The tasks.md reflects this ordering.

**[Risk] minItems schema gap breaks existing interview_me suspension tests** → Mitigation: `questions: []` test is new and explicit; existing suspension tests already use non-empty arrays — they pass through unaffected.
