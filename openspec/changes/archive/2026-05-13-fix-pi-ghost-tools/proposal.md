## Why

The Pi engine has two bugs that cause tool failures: on turns 2+, SDK built-in tools (`read`, `grep`, `find`, `ls`) silently disappear because session reuse overwrites the agent's full tool array with only custom tools. Additionally, the `run_command` tool description still references `search_text`, a tool removed in a prior release, causing the model to call a ghost tool that no longer exists.

## What Changes

- **Fix session reuse bug**: Replace the direct `agent.state.tools = tools` assignment on session reuse with `session.setActiveToolsByName()` — the proper SDK API that reads from the session registry and preserves SDK built-in tools
- **Introduce mutable `commonCtx` ref per conversation**: Mirror the existing `harnessContexts` pattern so `CommonToolContext` fields (`worktreePath`, `lspManager`) stay current without rebuilding tools every turn
- **Stop rebuilding tools on session reuse**: Once a session's tool closures are established at creation time, no rebuild is needed on subsequent turns — the mutable context ref keeps closures current
- **Fix `run_command` description**: Remove the `search_text` ghost reference; replace with `grep` and `find` (Pi SDK built-in equivalents)
- **Clean up ghost tool references in context management**: Remove `search_text` and `find_files` from `TOOL_RESULT_LIMITS` and `MICRO_COMPACT_CLEARABLE_TOOLS` in `conversation/context.ts`
- **Remove stale `search_text` display case**: In `pi/tools/display.ts`, remove the unreachable display handler for the removed tool

## Capabilities

### New Capabilities

*(none — this change is entirely corrective)*

### Modified Capabilities

- `pi-engine`: Session reuse requirement changes — tools must be updated via `setActiveToolsByName()` (not direct state assignment); engine maintains a mutable per-conversation `CommonToolContext` ref; no tool rebuild on session reuse
- `pi-tool-harness`: `run_command` tool description must not reference removed tools; `search_text` display case removed

## Impact

- **`src/bun/engine/pi/engine.ts`**: Core session management change — `commonCtxRefs` map added, `getOrCreateCommonContext()` method added, session reuse path changed
- **`src/bun/engine/pi/tools/shell.ts`**: Description string update (zero-risk)
- **`src/bun/engine/pi/tools/display.ts`**: Remove unreachable `search_text` case
- **`src/bun/conversation/context.ts`**: Remove stale entries from two constants
- **`src/bun/engine/pi/engine.ts`** (testability): Extract `protected createNewSession()` from `getOrCreateSession()` to expose a seam for DI in tests without bypassing the reuse path — no behavioural change
- No API surface changes, no DB migrations, no config changes required
- Existing Pi sessions (`.jsonl` files) are unaffected — the model recovers from "tool not found" errors on its own
