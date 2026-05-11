# Test Plan: Validate search_text removal and SDK search tool replacement

## Background

Search in the Pi engine was completely broken. Custom `search_text` tool depended on `ripgrep` (`rg`) which isn't installed. When `rg` was missing, `spawn_sync("rg")` returned `status === null` silently — indistinguishable from zero results.

## Approach

Replaced with Pi SDK's built-in `grep`, `find`, `ls` which auto-download `rg` via `ensure_tool("rg", true)`. Also removed `noTools: "builtin"` which was dead code when `tools` is explicitly passed.

## Changes

| File | Description |
|---|---|
| `src/bun/engine/pi/tools/search.ts` | Deleted — ~170 lines of broken code |
| `src/bun/engine/pi/tools/index.ts` | Removed `search` group (now `["read", "write", "shell", "web"]`) |
| `src/bun/engine/pi/engine.ts` | Added `tools: ["grep", "find", "ls"]`; removed `noTools: "builtin"` |
| `config/workflows/delivery.yaml` | Removed `- search` references |
| `src/bun/test/tool-registry.test.ts` | Added: `PI_TOOL_GROUPS` excluded, `columnGroups` filtering, cleanup validation |
| `src/bun/test/integration/pi-sdk-tool-events.test.ts` | Added: SDK `grep`/`find`/`ls` event pipeline validation |

## Verify

```bash
npx vitest run src/bun/test/tool-registry.test.ts src/bun/test/integration/pi-sdk-tool-events.test.ts --config=vitest.backend.config.ts
✓ 9 tests passing
```
