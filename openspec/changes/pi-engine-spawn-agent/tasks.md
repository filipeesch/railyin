## 1. Interfaces and Types

- [ ] 1.1 Define `SpawnConfig` interface in `src/bun/engine/pi/tools/index.ts` (model, streamFn, agentResolver, onChildEvent)
- [ ] 1.2 Extend `AllToolsOptions` with optional `spawnConfig?: SpawnConfig`
- [ ] 1.3 Define `AgentDefinition` interface (systemPrompt, tools, model?) in `src/bun/engine/pi/agent-resolver.ts`

## 2. AgentResolver

- [ ] 2.1 Create `src/bun/engine/pi/agent-resolver.ts` with `AgentResolver` class
- [ ] 2.2 Implement 3-level resolution: `.railyin/agents/` → `~/.railyin/agents/` → `config/agents/`
- [ ] 2.3 Parse YAML frontmatter (name, tools, model) and markdown body as system prompt
- [ ] 2.4 Return clear error message when agent name not found at any level

## 3. Built-in Agent Definitions

- [ ] 3.1 Create `config/agents/implementer.md` (tools: read/write/lsp/search — fills TODO skeletons, runs LSP to verify)
- [ ] 3.2 Create `config/agents/reviewer.md` (tools: read/lsp — structured JSON findings, security and quality focus)
- [ ] 3.3 Create `config/agents/researcher.md` (tools: read/search/web — research and summarize, cite sources)
- [ ] 3.4 Create `config/agents/tester.md` (tools: read/write/shell — runs test suite, fixes failures)

## 4. SpawnTool Implementation

- [ ] 4.1 Create `src/bun/engine/pi/tools/spawn.ts` with `buildSpawnTool(spawnConfig, harnessCtx, commonCtx)`
- [ ] 4.2 Define TypeBox parameters schema (children array: { agent?, instructions, tools? })
- [ ] 4.3 Implement MAX_CHILDREN=10 guard — return isError immediately if exceeded
- [ ] 4.4 Resolve named agents via `spawnConfig.agentResolver`; fail child with clear error if not found
- [ ] 4.5 Build child tool set: agent file tools for named agents, caller tools for anonymous
- [ ] 4.6 Build child `AllToolsOptions` without `spawnConfig` (recursion guard)
- [ ] 4.7 Create child `Agent` instances with resolved tools, system prompt, model
- [ ] 4.8 Subscribe to each child agent's events, translate via `translateEvent`, forward via `onChildEvent` with spawnCallId tag
- [ ] 4.9 Run all children with `Promise.all`, extract last assistant message text as result
- [ ] 4.10 Catch technical failures per child — set isError on tool result

## 5. Wire SpawnTool into buildAllTools

- [ ] 5.1 Import and call `buildSpawnTool` in `buildAllTools` when `spawnConfig` is present
- [ ] 5.2 Update `PI_TOOL_GROUPS` or add a separate path for spawn (spawn is not a harnessCtx tool)

## 6. Wire SpawnConfig into PiEngine

- [ ] 6.1 Construct `AgentResolver` in `createManagedExecution` (resolve worktreePath for project-level agents)
- [ ] 6.2 Build `SpawnConfig` with execution's model, streamFn, agentResolver, and `onChildEvent` closure over `events[]`
- [ ] 6.3 Pass `spawnConfig` into `buildAllTools` call
- [ ] 6.4 Tag forwarded child events with `parentCallId` only (no `isInternal` — that suppresses events in stream-processor); extend `EngineEvent` `token` type with `parentCallId?: string`; update stream-processor `text_chunk` emit to pass `parentBlockId: event.parentCallId ?? null`

## 7. Bug Fixes and Cleanup

- [ ] 7.1 Fix `PiEngine.cancel()` — add `executionId → conversationId` map; abort only the target session's agent
- [ ] 7.2 Add lifecycle cleanup for `sessions` and `harnessContexts` maps (hook into task archive/delete via orchestrator)
- [ ] 7.3 Fix `spawn_agent` tool description in `src/bun/workflow/tools/registry.ts` — remove incorrect "full parent context" claim
