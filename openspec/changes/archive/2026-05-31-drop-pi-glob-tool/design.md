## Context

The Pi harness has a custom `glob` tool in `src/bun/engine/pi/tools/read.ts` for file discovery. The Pi SDK (v0.74.0) ships a built-in `find` tool that is already registered and always active via `SDK_BUILTIN_TOOL_NAMES`. The `find` tool uses `fd` under the hood, respects `.gitignore`, and caps results at 1000.

The custom `glob` tool has a critical performance defect: it calls `statSync` inside a sort comparator, producing O(n log n) disk I/O. On a repo with 8,000 files, that means ~200,000 `statSync` calls — 10–30 seconds of wall time.

## Goals / Non-Goals

**Goals:**
- Remove the custom `glob` tool and all its registration points
- Eliminate the performance bug by removing the broken code
- Keep the `read` tool group infrastructure intact (it may host future tools)
- Update tool descriptions to reference `find` instead of `glob`

**Non-Goals:**
- Changing the Pi SDK's `find` tool behaviour
- Adding mtime-sorting or pagination to `find` (SDK-owned, out of scope)
- Changing any other engine (Claude, Copilot, OpenCode) — they have their own `glob` handling unrelated to this

## Decisions

### Decision: Remove glob entirely rather than fix it

**Chosen:** Remove the tool.

**Rationale:** The SDK `find` tool already covers the use case, is faster, and is gitignore-aware. Fixing glob (caching stats, adding gitignore, adding a cap) would add complexity to maintain a redundant tool. Models can use `find` for file discovery.

**Alternative considered:** Fix the statSync performance bug by caching stats in a Map before sorting. Rejected — maintains a redundant tool when `find` already exists.

### Decision: Keep the `read` tool group (returning empty)

**Chosen:** Keep `PI_TOOL_GROUPS.read` but have `buildReadTools` return `[]`.

**Rationale:** Workflow YAML configs may reference `tools: ["read", "write", "shell"]`. Removing the `read` key would silently ignore those configs (the filter in `buildAllTools` uses `g in PI_TOOL_GROUPS`). Keeping the group as empty is backward-compatible and avoids needing to audit all YAML configs.

**Alternative considered:** Remove the `read` key entirely. Rejected — breaks any workflow YAML listing `"read"` in its tool groups.

## Risks / Trade-offs

- [Models accustomed to calling `glob`] → `find` is already available and semantically equivalent. The SDK instruction prompt already teaches models to use `find`. No migration prompt needed.
- [Scenarios in pi-tool-harness spec reference `glob`] → Delta specs will update those scenarios to reference `find` instead.

## Migration Plan

No deployment steps. The change is purely a code removal — no data migrations, no API surface changes, no config changes required. Rollback is a git revert.
