## Context

`validateToolArgs` is a pure function — it takes a definition and a `Record<string, unknown>`, runs AJV against the schema, and returns `null` or a formatted string. There are no side effects, no DB, no context object. This makes it the easiest class of code to test.

The three existing test files (`tasks-tools.test.ts`, `claude-tools.test.ts`, `common-tools-registration.test.ts`) all pass stringified args today because `toToolArgs()` stringified everything before it reached the handlers. After the refactor, those calls become type errors. They must be migrated to typed values before the test suite can go green.

The key constraint: **no mocking of `validateToolArgs` in integration tests**. The validator runs as a real gate inside `executeCommonTool`. Tests should pass valid args when testing handler logic, and invalid args when testing the validation gate — not mock the validator out. This is intentional: bypassing the gate in tests would mean tests don't reflect production behaviour.

## Goals / Non-Goals

**Goals:**
- Pure unit tests for `validateToolArgs` covering all error categories defined in the spec.
- Migration of three existing test files to typed args (no more `String(taskId)`).
- New integration scenarios that exercise the validation gate via `executeCommonTool` directly.
- Verify that all `COMMON_TOOL_DEFINITIONS` schemas compile in AJV without throwing (meta-test).

**Non-Goals:**
- Playwright / UI tests — validation errors are backend-only and indistinguishable from other tool result strings in the UI.
- End-to-end engine tests (orchestrator, stream processor) for validation — out of scope, covered by unit + integration layers.
- Mocking AJV or `validateToolArgs` in any test — the gate must be exercised for real.

## Decisions

### D1 — Pure unit test file for the validator, no DB/ctx setup

`validate-tool-args.test.ts` imports `validateToolArgs` and tool definitions directly. No `initDb()`, no `setupTestConfig()`, no `beforeEach`. Each test is a synchronous call and assertion.

**Rationale:** The function is pure. DB setup is expensive and irrelevant.

### D2 — Integration scenarios live in existing test files, not in validate-tool-args.test.ts

New scenarios that test `executeCommonTool("update_todo_status", { status: "finished" }, ctx)` belong in `tasks-tools.test.ts` next to existing handler tests. Keeps test organisation by subject (what tool is being tested) rather than by layer.

### D3 — Error assertion regexes, not exact strings

Updated assertions use `toMatch(/pattern/)` rather than `toBe("exact string")`. The AJV-formatted messages are slightly different from the old ad-hoc messages; loose regexes survive future message wording adjustments without breaking tests.

**Example:** old: `expect(text).toBe("Error: questions is required")` → new: `expect(text).toMatch(/questions/)` and `expect(text).toMatch(/required|at least/)`.

### D4 — ZodLike spy tests in claude-tools.test.ts are UNCHANGED

The `buildClaudeToolServer` schema registration path (Zod-to-Claude-SDK translation) is not affected by this change. Those tests continue to verify the schema shape passed to the SDK. Do not touch them.

### D5 — No DI for the validator

`executeCommonTool` calls `validateToolArgs` directly. Tests do not inject a fake validator. Tests that want to test handler logic pass valid args; tests that want to test the gate pass invalid args. This is the correct DI stance: the gate IS the behaviour.

## Risks / Trade-offs

**[Risk] Assertion string brittleness** → Mitigation: D3 — regex-based assertions throughout.

**[Risk] Missing a stringified-arg site in the migration** → Mitigation: `bun test src/bun/test --timeout 20000` will surface TypeScript compile errors; grep for `String(` and `JSON.stringify(` in test files as a final check.

**[Risk] AJV schema compilation failures for some tool definitions** → Mitigation: the meta-test (D1, scenario V-11) explicitly compiles every `COMMON_TOOL_DEFINITIONS` schema through `new Ajv().compile()` and expects no throws.

## Migration Plan

1. Ensure `structured-tool-input-validation` is fully implemented first (this is a test-only proposal that depends on the production code existing).
2. Write `validate-tool-args.test.ts` first — validates the core function in isolation.
3. Run `bun test src/bun/test/validate-tool-args.test.ts` to confirm it passes before touching existing files.
4. Migrate `tasks-tools.test.ts` (largest file, most stringified args).
5. Migrate `claude-tools.test.ts` (interview_me args + assertion updates).
6. Migrate `common-tools-registration.test.ts` (smallest, interview_me only).
7. Run full suite: `bun test src/bun/test --timeout 20000`.

## Open Questions

None.
