## Why

The Pi engine's custom `glob` tool is redundant — the Pi SDK already ships a built-in `find` tool that is gitignore-aware, uses `fd` under the hood, and has a hard result cap. The custom `glob` implementation has a critical performance bug: it calls `statSync` inside a sort comparator, resulting in O(n log n) disk I/O that can hang for 10–30 seconds on large repos with wide patterns like `**/*`.

## What Changes

- **REMOVE** the custom `glob` tool from the Pi harness (`src/bun/engine/pi/tools/read.ts`)
- **REMOVE** `"glob"` from the SDK tool allowlist in `src/bun/engine/pi/engine.ts`
- **REMOVE** the `read` tool group from `PI_TOOL_GROUPS` and `DEFAULT_PI_TOOL_GROUPS` (now empty after glob removal)
- **UPDATE** `run_command` tool description to reference `find` (not `glob`) for file discovery
- **REMOVE** `case "glob"` from `src/bun/engine/pi/tools/display.ts`
- **UPDATE** tool registry test to reflect the removed group and tool

The Pi SDK's built-in `find` tool is already enabled via `SDK_BUILTIN_TOOL_NAMES` and respects `.gitignore`, caps results at 1000, and executes via `fd` (native speed).

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `pi-tool-harness`: The `read` tool group no longer contributes `glob`; scenarios referencing `glob` must be updated to reflect that file discovery is handled by the SDK `find` tool.
- `pi-native-tools`: Scenario referencing `glob` in the read group must be removed.

## Impact

- `src/bun/engine/pi/tools/read.ts` — glob tool and params removed; `safePath` helper stays (used by write/undo tools)
- `src/bun/engine/pi/tools/index.ts` — `read` group removed from `PI_TOOL_GROUPS` and `DEFAULT_PI_TOOL_GROUPS`
- `src/bun/engine/pi/tools/display.ts` — `case "glob"` removed
- `src/bun/engine/pi/tools/shell.ts` — `run_command` description updated
- `src/bun/engine/pi/engine.ts` — `"glob"` removed from SDK allowlist
- `src/bun/test/tool-registry.test.ts` — assertions updated
- No API surface changes; no frontend impact; no database changes
