## Context

The `interview_me` tool renders a deliberation UI (`InterviewMe.vue`) where Claude asks the user structured questions. The submit button is always disabled in the Claude Code engine, making the feature completely unusable there.

**Root cause investigation** (confirmed via SDK runtime testing) revealed three compounding bugs:

**Bug 1 — Schema gap (PRIMARY, Claude-engine only):**  
`jsonSchemaToZodShape()` in `src/bun/engine/claude/tools.ts` only handles scalar types (`string`, `number`, `boolean`). The `questions` parameter is `type: "array"` → falls to `default: z.any()`. When converted to MCP JSON Schema via Zod's `toJSONSchema()`, `z.any()` produces `{}` (empty schema). Claude Code sees `"questions": {}` in the tool listing — no type enum, no items structure. It infers its own type values (e.g., `"single"` instead of `"exclusive"`). These unknown types fall through to the `non_exclusive` branch of `canSubmit`, which checks `multiSelected[qi].length > 0` — always 0 → submit disabled.

Confirmed with live SDK testing:
```
z.any()      → MCP tools/list: "questions": {}            (empty)
z.array(...) → MCP tools/list: "questions": { "type": "array", "items": {...} }  (correct)
```

**Bug 2 — non_exclusive row-click UX gap (SECONDARY, all engines):**  
`onRowClick()` only calls `singleSelected.value[qi] = title` for `exclusive` questions. For `non_exclusive`, it only updates `focusedOption` (opens description panel). `canSubmit` checks `multiSelected[qi].length > 0` — never set by row click → always 0 → submit disabled.

**Bug 3 — State re-init gap (TERTIARY):**  
Reactive arrays (`singleSelected`, `multiSelected`, etc.) are initialized once via `props.questions.map()`. If props change after mount there is no `watch` re-sync → stale empty arrays.

## Goals / Non-Goals

**Goals:**
- Fix Zod schema translation to fully represent nested `array`, `object`, and `enum` types so Claude receives a complete MCP tool schema
- Fix `non_exclusive` row-click so clicking a row both opens the description and toggles the selection (consistent with `exclusive`)
- Add defensive type normalization in the Claude engine path (guard against unknown type values from any source)
- Add `watch`-based re-initialization for `InterviewMe.vue` reactive state when questions prop changes
- Cover the entire `InterviewMe` widget with Playwright tests (7 test cases, all mock-API)

**Non-Goals:**
- Changing `InterviewPayload` or `InterviewQuestion` types in `rpc-types.ts`
- Changing how `interview_me` is triggered or persisted in the orchestrator
- Supporting raw JSON Schema as `inputSchema` to `sdk.tool()` (the SDK wraps Zod shapes; raw objects lose their `properties` structure)
- Fixing any other common tools' schema translation (though the fix is general-purpose)

## Decisions

### Decision 1: Extend `schemaPropToZod` recursively instead of bypassing Zod

**Chosen:** Extend `ZodLike`, `schemaPropToZod`, and `jsonSchemaToZodShape` to recursively handle `type: "array"`, `type: "object"`, and `enum` on strings.

**Alternatives considered:**
- *Pass raw JSON Schema directly to `sdk.tool()`*: Rejected. Confirmed via SDK testing that plain `{ type: "array", items: {...} }` objects produce `"properties": {}` in the MCP listing because the SDK calls `.toJSONSchema()` on each shape value and plain objects don't implement that interface.
- *Replace `jsonSchemaToZodShape` with `zod-to-json-schema`*: Rejected. The project uses Zod v4 (`4.3.6`); `zod-to-json-schema` v3 does not support Zod v4 shape, and the recursive-Zod approach keeps the fix self-contained.
- *Hardcode interview_me schema instead of translating*: Rejected. A general fix benefits all current and future tools with array/object parameters.

**Implementation:**
```typescript
type ZodLike = {
  string: () => ZodScalar;
  number: () => ZodScalar;
  boolean: () => ZodScalar;
  any: () => ZodScalar;
  array: (item: unknown) => ZodScalar;          // NEW
  object: (shape: Record<string, unknown>) => ZodScalar;  // NEW
  enum: (values: [string, ...string[]]) => ZodScalar;     // NEW
};

function schemaPropToZod(z: ZodLike, prop: Record<string, unknown>, required: boolean): unknown {
  switch (type) {
    case "array": {
      const items = (prop.items ?? {}) as Record<string, unknown>;
      const item = schemaPropToZod(z, items, true);  // items are always required in type sense
      base = z.array(item);
      break;
    }
    case "object": {
      const shape = jsonSchemaToZodShape(z, prop);  // recursive
      base = z.object(shape);
      break;
    }
    case "string": {
      if (Array.isArray(prop.enum) && prop.enum.length > 0) {
        base = z.enum(prop.enum as [string, ...string[]]);
      } else {
        base = z.string();
      }
      break;
    }
    // ... existing number, boolean, default: z.any()
  }
}
```

### Decision 2: Toggle `multiSelected` on row click for `non_exclusive`

**Chosen:** In `onRowClick`, after updating `focusedOption`, call `onCheckboxClick(qi, q, title)` when `q.type === 'non_exclusive'`. This reuses existing toggle logic rather than duplicating it.

**Alternatives considered:**
- *Change checkbox to `input type="radio"` for exclusive*: Not a fix for the bug; just a different rendering approach.
- *Show separate click zone for selection vs description*: More complex UI change; not needed since `exclusive` click-to-select already works as the expected pattern.

### Decision 3: Defensive type normalization in `common-tools.ts`

**Chosen:** Mirror the normalization already present in `workflow/engine.ts` (line 1744):
```typescript
const validTypes = ["exclusive", "non_exclusive", "freetext"] as const;
q.type = validTypes.includes(q.type as typeof validTypes[number]) ? q.type : "exclusive";
```
Applied in the `interview_me` case of `executeCommonTool` before calling `ctx.onInterviewMe`.

**Rationale:** Defense-in-depth. Even after Fix 1, Claude could theoretically send an unrecognized type. This prevents `canSubmit` from silently failing.

### Decision 4: `watch` re-init in `InterviewMe.vue`

**Chosen:** Add `watch(() => props.questions, (newQuestions) => { /* reset all per-question state arrays */ }, { immediate: false })`. Does not run on mount (initialization handles that), only fires on subsequent changes.

### Decision 5: Playwright tests use mock-API pattern (no backend)

`playwright.config.ts` uses `vite preview` with `e2e/ui/fixtures/mock-api.ts` intercepting all API and WebSocket calls. Tests seed an `interview_prompt` message by mocking `conversations.getMessages` to return a `ConversationMessage` with `type: "interview_prompt"` and `content: JSON.stringify(payload)`. No Bun server required. This matches all existing UI Playwright tests.

## Risks / Trade-offs

- **`z.enum()` with Zod v4**: Zod v4 changed the `enum` API. Need to verify `z.enum(['a','b','c'])` is the correct call form (not `z.enum({a:'a'})` or similar). If the runtime Zod instance differs from the import, a runtime guard falls back to `z.string()`.
- **`z.object()` and `z.array()` on the injected ZodLike**: The `z` passed into `buildClaudeToolServer` comes from `loadZodRuntime()` (dynamic import of `"zod"`). Adding `array` and `object` to `ZodLike` is safe since they are standard top-level Zod exports.
- **Row-click toggle for non_exclusive is a behavior change**: Users who relied on row-click being purely "open description" can no longer do so without toggling selection. This is the correct and expected behavior — confirmed by user in exploration phase.
- **Existing tests**: No existing Playwright tests cover `InterviewMe`. The 7 new tests are net-new coverage, no regressions expected.

## Migration Plan

No DB migrations, no API contract changes, no config changes. Deploy is a standard frontend bundle + backend restart.

## Open Questions

- None. All three root causes confirmed with live SDK testing. Fix strategies confirmed with user.
