## Why

The Pi engine (which runs OpenAI-compatible models like Qwen) fails to accept `decision_request` tool calls when the model serializes array/object parameters as JSON-encoded strings instead of native JSON values. Models like Qwen, GPT, and other non-Anthropic models exhibit this behavior. When `decision_request.questions` arrives as a JSON string `"[{...}]"` instead of a native array, the Pi SDK's built-in validation throws `"Validation failed for tool decision_request: questions must be array"` before the tool's execute function is ever called.

This blocks task execution for any model that serializes complex parameters as strings — a known pattern with several OpenAI-compatible models.

## What Changes

- Create a new schema-driven `normalizeArgs` module that JSON-parses string values when the tool's JSON Schema indicates the property should be an array or object
- Add `prepareArguments` to all Pi engine tools so normalization runs **before** the SDK's validation layer (via the SDK's built-in hook)
- Extract `normalizeArgs` from `buildCommonTools` into a standalone module: `src/bun/engine/normalize-args.ts`
- Deep/recursive normalization handles nested array/object properties (e.g., `options` inside `decision_request.questions[0]`)

**No behavior change for models that send native JSON** — the normalizer skips non-string values entirely.

## Capabilities

### New Capabilities
- `pi-tool-args-normalization`: Schema-driven pre-validation argument normalization for the Pi engine's agent tools

### Modified Capabilities
- _(none — no existing spec-level requirements change)_

## Impact

- **New file**: `src/bun/engine/normalize-args.ts` (shares a generic concern across all agent paths)
- **Modified file**: `src/bun/engine/pi/tools/common.ts` (adds `prepareArguments` to tool wrappers)
- Affects all Pi engine tool calls — zero behavioral change for native JSON inputs; string-encoded params get parsed before SDK validation
- No changes to API contracts, database schemas, or I/O layers
- Claude/Copilot/OpenCode paths are unaffected (their models pass native JSON)
