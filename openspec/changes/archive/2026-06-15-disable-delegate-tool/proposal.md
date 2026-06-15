## Why

The delegate tool (fan-out parallel sub-agents) on the Pi engine is being disabled. The tool registration and its exclusive supporting infrastructure are no longer needed and should be removed from the active tool surface.

## What Changes

- **Comment out** the `delegate` tool registration in `src/bun/engine/pi/tools/index.ts` — the `buildDelegateTool` import, the variable assignment, and its spread in the `buildAllTools()` return value.
- **Remove** `buildChildTools()` and `CHILD_COMMON_TOOL_NAMES` from `tools/index.ts` — these are delegate-only exports with no other production consumers.
- **Comment out** the `delegateEmitRefs` infrastructure in `engine.ts` — the Map field, `getOrCreateDelegateEmitRef()` method, event wiring in `createManagedExecution()`, and shutdown cleanup.
- **Comment out** the `delegate` display case in `display.ts`.
- **Remove** delegate-only fields from `AllToolsOptions` interface: `delegateEmitRef`, `childSessionFactory`, `limiterRegistry`, `parentModel`, `parentSystemPrompt`, `parentConversationId`, `parentCwd`, `engineConfig`, `onRawModelMessage`.
- **Remove** delegate-only options from the `buildAllTools()` call in `engine.ts`.

Files `delegate.ts`, `child-session.ts`, and `PiDelegateConfig` in `config/index.ts` are **preserved intact** — not deleted or commented. They remain as reference and can be re-enabled by reversing the registration changes.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `spawn-agent`: The `spawn_agent` / `delegate` fan-out capability is disabled on the Pi engine. The tool is no longer registered and child sessions are no longer spawned. Existing spec requirements become inactive — no new behavior is introduced, the capability is simply deactivated.

## Impact

- **Files modified**: `src/bun/engine/pi/tools/index.ts`, `src/bun/engine/pi/engine.ts`, `src/bun/engine/pi/tools/display.ts`
- **Files preserved** (not touched): `src/bun/engine/pi/tools/delegate.ts`, `src/bun/engine/pi/child-session.ts`, `src/bun/config/index.ts`
- **Tests affected** (out of scope for this change): `src/bun/test/pi/delegate.test.ts`, `src/bun/test/tool-registry.test.ts`, `src/bun/test/pi-session-tools-integration.test.ts`
- **No breaking API changes** — the delegate tool is an internal agent tool, not part of any public API or RPC contract.
