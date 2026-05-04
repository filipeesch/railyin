## 1. Preparation

- [x] 1.1 Merge `origin/main` into `task/377-open-code-support`
- [x] 1.2 Install `@opencode-ai/sdk` and add to `package.json` dependencies
- [x] 1.3 Verify `createOpencodeServer()` from `@opencode-ai/sdk` v2 bundles or can resolve the `opencode` binary

## 2. Types and Config

- [x] 2.1 Widen `EngineLeaseMetadata.engine` and `LeaseRegistry` constructor `engine` param from `"copilot" | "claude"` to `string` in `src/bun/engine/types.ts` and `src/bun/engine/lease-registry.ts`
- [x] 2.2 Widen `RawModelMessage.engine` from `"claude" | "copilot"` to `string` in `src/bun/engine/types.ts`
- [x] 2.3 Define `OpenCodeProviderConfig` and `OpenCodeEngineConfig` types in `src/bun/engine/opencode/types.ts`
- [x] 2.4 Define `OpenCodeSdkAdapter` interface and `OpenCodeExecutionContext` type in `src/bun/engine/opencode/types.ts`
- [x] 2.5 Add `OpenCodeEngineConfig` to the `EngineConfig` union in `src/bun/config/index.ts`
- [x] 2.6 Add `engine.type === "opencode"` validation branch in `src/bun/config/index.ts`

## 3. Event Translation

- [x] 3.1 Implement `translatePart()` in `src/bun/engine/opencode/event-translator.ts` — maps `TextPart`, `ReasoningPart`, `ToolPart` (running/completed/error) to `EngineEvent`
- [x] 3.2 Implement global event handlers in `event-translator.ts` — `EventPermissionUpdated` → `shell_approval`, `EventSessionIdle` → `done`, `EventSessionStatus` → `status`, token counts → `usage`

## 4. Attachment Mapper

- [x] 4.1 Implement `mapAttachments()` in `src/bun/engine/opencode/attachment-mapper.ts` — converts Railyin `Attachment[]` to OpenCode `FilePartInput[]`

## 5. SDK Adapter

- [x] 5.1 Create `src/bun/engine/opencode/adapter.ts` with `DefaultOpenCodeSdkAdapter` class
- [x] 5.2 Implement server startup: call `createOpencodeServer({ config })` once, store `{ url, close }`, guard against duplicate starts
- [x] 5.3 Implement `sessionMap: Map<conversationId, sessionId>` — create session on first use, resume on subsequent calls
- [x] 5.4 Implement `contextMap: Map<conversationId, OpenCodeExecutionContext>` — set before prompt, delete in finally block
- [x] 5.5 Implement MCP registration: on server start, spawn Railyin MCP HTTP server and call `POST /mcp` to register it with the OpenCode server
- [x] 5.6 Implement `mapConfig()` helper — converts `OpenCodeEngineConfig.providers` map to OpenCode `Config.provider` format
- [x] 5.7 Export `createDefaultOpenCodeSdkAdapter()` factory from `src/bun/engine/opencode/index.ts`

## 6. Engine Implementation

- [x] 6.1 Create `src/bun/engine/opencode/engine.ts` with `OpenCodeEngine` class implementing `ExecutionEngine`
- [x] 6.2 Implement `execute()` — resolve session, register context, send prompt with system instructions and `conversationId`, stream translated events, cleanup context on exit
- [x] 6.3 Implement `resume()` — resolve pending `waitForResume` promise for shell approval and ask_user flows
- [x] 6.4 Implement `cancel()` — trigger abort signal for in-flight execution
- [x] 6.5 Implement `compact()` — call OpenCode session summarize endpoint, emit `compaction_start` / `compaction_done` events
- [x] 6.6 Implement `listModels()` — query OpenCode provider and model endpoints, return `EngineModelInfo[]` with `providerID/modelID` qualified IDs
- [x] 6.7 Implement `listCommands()` — call `GET /skill`, map to `CommandInfo[]`
- [x] 6.8 Implement `shutdown()` — call `server.close()`, clear session and context maps

## 7. Resolver Wiring

- [x] 7.1 Add `"opencode"` case to `src/bun/engine/resolver.ts` — instantiate `OpenCodeEngine` from `OpenCodeEngineConfig`

## 8. Raw Message Logging

- [x] 8.1 Call `params.onRawModelMessage?.()` in `execute()` for each SSE event with `engine: "opencode"` — redact `apiKey` values before passing payload
