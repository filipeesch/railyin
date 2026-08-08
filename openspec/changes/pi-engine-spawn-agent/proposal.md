## Why

The Pi engine (local-LLM harness) launched without `spawn_agent` support, leaving parallel sub-task delegation unavailable to local models. The Pi SDK has no native branching, so spawn_agent must be implemented as a fresh in-memory sub-loop — similar in spirit to the old native engine but redesigned around Pi's `Agent` class, dependency injection, and a user-configurable named-agent system.

## What Changes

- **New**: `spawn_agent` tool added to the Pi engine via `buildAllTools` / `AllToolsOptions`
- **New**: `SpawnConfig` interface injected into `AllToolsOptions` — holds model, streamFn, agentResolver, and onChildEvent callback
- **New**: `AgentResolver` service loads named agent definitions from `.railyin/agents/`, `~/.railyin/agents/`, and `config/agents/` (shipped defaults)
- **New**: `config/agents/` directory with built-in agent definitions (`implementer.md`, `reviewer.md`, `researcher.md`, `tester.md`)
- **New**: Child events (tokens + tool calls) streamed to parent UI via `parentCallId` nesting — `EngineEvent` `token` type extended with `parentCallId?: string`; stream-processor propagates it as `parentBlockId` on `text_chunk` emit
- **Modified**: `PI_TOOL_GROUPS` and `buildAllTools` extended to accept and pass through `SpawnConfig`
- **Modified**: `spawn_agent` tool description in `workflow/tools/registry.ts` corrected (currently says "full parent context" — wrong)
- **Cleanup**: `PiEngine.cancel()` bug fixed — currently aborts ALL sessions; needs `executionId→conversationId` map
- **Cleanup**: `sessions` / `harnessContexts` maps get lifecycle cleanup on task archive/delete

## Capabilities

### New Capabilities

- `pi-spawn-agent`: spawn_agent tool for the Pi engine — parallel in-memory child Agent instances, named agent resolution, full event streaming, and technical-only success signaling

### Modified Capabilities

- `spawn-agent`: Requirements updated to reflect Pi engine's design differences — fresh context only (no `parentContext` inheritance), agent-file-owned tools, named agent invocation, and no interception model (Pi tools are native `AgentTool.execute()` not intercepted at engine loop level)

## Impact

- `src/bun/engine/pi/tools/index.ts` — `AllToolsOptions`, `buildAllTools`, `SpawnConfig`
- `src/bun/engine/pi/tools/spawn.ts` — new file, `buildSpawnTool`
- `src/bun/engine/pi/agent-resolver.ts` — new file, `AgentResolver`
- `src/bun/engine/pi/engine.ts` — pass `SpawnConfig` into `buildAllTools`, fix `cancel()`, add session cleanup
- `config/agents/` — new directory with 4 built-in agent markdown files
- `src/bun/workflow/tools/registry.ts` — fix `spawn_agent` description
- `src/bun/engine/types.ts` — extend `token` EngineEvent with `parentCallId?: string`
- `src/bun/engine/stream/stream-processor.ts` — pass `parentCallId` as `parentBlockId` on `text_chunk` emit
