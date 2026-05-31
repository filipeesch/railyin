## Context

The Pi engine exposes `write_file` and `patch_file` to local LLMs (Qwen and others). Local models generate tool arguments in JSON Schema property declaration order. The `patch_file` schema declares `content` last (`path, anchor, position, content`), causing models to frequently omit it — producing an AJV validation error, a generic error message, and a wasteful retry loop. `write_file` already has `content` in position 2 (`path, content`) but its description provides no emphasis that `content` is required, and it lacks a `prepareArguments` hook, leading to similar failures.

The `prepareArguments` hook is the standard Pi SDK extension point for pre-validation normalization. All common tools in `common.ts` use it via `normalizeToolArguments`. Write tools currently bypass it entirely — an inconsistency to close.

## Goals / Non-Goals

**Goals:**
- Move `content` to an earlier schema position in `patch_file` so models encounter and fill it before more structurally complex params
- Strengthen `content` field descriptions with an explicit `REQUIRED` marker in both tools
- Add a required-params list and concrete JSON example to both tool descriptions
- Add `prepareArguments` hooks that throw a targeted error when `content` is missing, so the model receives a helpful message instead of generic AJV output
- Stay consistent with the `common.ts` hook pattern

**Non-Goals:**
- Changing tool execution logic or file system semantics
- Modifying `delete_file` or `rename_file` (no `content` param, lower failure rate)
- Splitting `patch_file` into multiple atomic tools
- Changing the SDK, `normalize-args.ts`, or any file other than `write.ts`

## Decisions

### D1: Reorder `patchFileParams` to `path → content → anchor → position`

**Why**: TypeBox/JSON Schema property insertion order is preserved in the generated schema output, and LLMs use property order as a generation hint. Moving `content` to slot 2 ensures it is filled early, before `anchor` (a potentially long string) and `position` (an enum the model may reason about). `write_file` already has this ordering.

**Alternatives considered**:
- *Rename `content` to `text` to make it sound simpler*: Rejected — breaks consistency with existing tool ecosystem, confuses models trained on `content`.
- *Split into atomic tools*: Rejected by user — increased surface area and model confusion.

### D2: `prepareArguments` checks only `content`, not all required params

**Why**: `content` is the observed failure mode. Other params (`path`, `anchor`) are rarely forgotten. Checking only `content` is a targeted fix; all other missing-param cases fall through to the SDK's AJV message, which is sufficient for them.

**Error message format** (mirrors SDK's own style):
```
write_file: "content" is required — provide the full file text as a string
patch_file: "content" is required — provide the text to insert or replace as a string
```

### D3: Extract a private `requireContent(toolName, rawArgs)` helper

**Why**: Both tools share the same guard. A single file-level helper keeps both `prepareArguments` implementations DRY and easy to update. No external import needed — the helper is co-located in `write.ts`.

### D4: Add concrete JSON example to tool descriptions

**Why**: Local LLMs respond well to in-context examples. A single representative JSON snippet anchors the model's generation. The example should show all four required params for `patch_file` (with `content` immediately after `path`) and both params for `write_file`.

## Risks / Trade-offs

- **Schema reordering is a soft signal, not a hard fix**: Some models may still omit `content`. The `prepareArguments` hook is the hard backstop.
- **`prepareArguments` only fires before AJV**: If the SDK itself has a bug or skips the hook, the fallback is the existing AJV error. Acceptable risk given SDK stability.
- **JSON example in description takes tokens**: Descriptions are part of the tool schema sent to the model on every turn. The example adds ~10-15 tokens. Negligible.

## Migration Plan

Single-file change to `src/bun/engine/pi/tools/write.ts`. No DB migration, no API change, no restart required beyond the normal dev cycle. Existing tests in `src/bun/test/` cover write tool execution logic and should continue to pass unchanged.
