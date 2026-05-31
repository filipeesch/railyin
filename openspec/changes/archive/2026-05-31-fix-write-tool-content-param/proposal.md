## Why

Local LLMs (Qwen and others) running on the Pi engine repeatedly omit the `content` parameter when calling `write_file` and `patch_file`, producing validation errors and costly retry loops. The root causes are: `content` is last in the `patch_file` schema (models generate in property order), descriptions lack explicit emphasis on required params, and there is no early validation hook to return a targeted error message before the generic AJV error fires.

## What Changes

- **Reorder `patchFileParams` schema**: move `content` from 4th to 2nd position (`path → content → anchor → position`) so models encounter and fill it before the more structurally complex params
- **Strengthen `content` field descriptions** in both `write_file` and `patch_file` with an explicit `REQUIRED` marker
- **Clarify `anchor` description**: note it is ignored when `position` is `start` or `end`
- **Improve tool-level descriptions** for both tools: add a required-params list and a concrete JSON example
- **Add `prepareArguments` hook** to `writeFileTool` and `patchFileTool`: throws a targeted error if `content` is missing before SDK AJV validation runs, consistent with the `common.ts` pattern

## Capabilities

### New Capabilities
- none

### Modified Capabilities
- `write-tools`: Adding `prepareArguments` validation hook and improving schema/descriptions for `write_file` and `patch_file` to reduce model-side content-param omission errors.

## Impact

- `src/bun/engine/pi/tools/write.ts` — sole file changed
- No API, DB, or RPC changes
- Improves reliability for all Pi engine sessions using write tools (Qwen, other local LLMs)
