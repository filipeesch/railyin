## 1. Create normalize-args module

- [x] 1.1 Create `src/bun/engine/normalize-args.ts` with exported `normalizeToolArguments(schema, rawArgs)` function
- [x] 1.2 Implement shallow normalization: check each property's schema type, JSON-parse strings for `type: "array"` and `type: "object"`
- [x] 1.3 Implement deep recursion: walk `items` for arrays and `properties` for nested objects
- [x] 1.4 Add type guards: only parse strings, skip `type: "string"`/`number`/`boolean`/`null` values
- [x] 1.5 Add error safeguards: try/catch on every JSON.parse, validate result type, preserve original on failure
- [x] 1.6 Skip `allOf`/`anyOf`/`oneOf` combinations (commented TODO for future)

## 2. Wire into Pi engine tool wrappers

- [x] 2.1 Update `src/bun/engine/pi/tools/common.ts` to import `normalizeToolArguments` from new module
- [x] 2.2 Add `prepareArguments: (args) => normalizeToolArguments(def.parameters, args)` to each tool built in `buildCommonTools()`
- [x] 2.3 Remove or comment-out the existing `normalizeArgs` call inside the tool's `execute` function (now redundant — pre-normalization happens via prepareArguments)
- [ ] 2.4 Verify the tool flow: prepareArguments → SDK validation → execute receives normalized args

## 3. Verify existing tools still work

- [x] 3.1 Verify `decision_request` with native array `questions` — no change in behavior
- [x] 3.2 Verify `reorganize_todos` with native array `items` — no change in behavior
- [x] 3.3 Verify scalar-only tools (`get_task`, `move_task`, `message_task`) — no change in behavior

## 4. Run existing tests

- [x] 4.1 Run `bun test src/bun/test/claude-tools.test.ts` (decision_request schema tests)
- [x] 4.2 Run `bun test src/bun/test/claude-rpc-scenarios.test.ts` (decision_request event test)
- [x] 4.3 Run `bun test src/bun/test/validate-tool-args.test.ts` (validation tests V-6 through V-9)
- [x] 4.4 Run `bun test src/bun/test/common-tools-registration.test.ts` (CTR-D-1 etc.)
- [x] 4.5 Run `bun test src/bun/test/decision-submission.test.ts`
- [x] 4.6 Run `bun test src/bun/bun/test --timeout 20000` (full suite)
