## 1. Setup & Dependencies

- [ ] 1.1 Add `@mariozechner/pi-coding-agent` to `package.json` and run `bun install`
- [ ] 1.2 Create `src/bun/engine/pi/` directory structure (engine.ts, config.ts, event-translator.ts, session-manager.ts, harness/, tools/)
- [ ] 1.3 Add `PiEngineConfig` type to `src/bun/config/index.ts` `EngineConfig` union
- [ ] 1.4 Add `engines.yaml.sample` entry for Pi engine with LM Studio provider example

## 2. Harness Infrastructure

- [ ] 2.1 Implement `ContentHashCache` class (`harness/hash-cache.ts`) — file path → `{ hash, seenInWindow, turnNumber }`, `resetWindowFlags()`, `invalidate(path)`
- [ ] 2.2 Implement `UndoStack` class (`harness/undo-stack.ts`) — `push(snapshot)`, `undoById(operationId)`, `undoByPath(path)`, 50-entry FIFO cap
- [ ] 2.3 Define `HarnessContext` interface (`harness/context.ts`) — `{ hashCache, undoStack, worktreePath, searchConfig }`

## 3. Native Tools

- [ ] 3.1 Implement read tools (`tools/read.ts`) — `read_file` (with hash cache integration), `list_dir`; path-safety via `safePath()`
- [ ] 3.2 Implement write tools (`tools/write.ts`) — `write_file`, `patch_file` (anchor-based), `delete_file`, `rename_file`; each pushes undo snapshot and returns `[op:XXXX]`
- [ ] 3.3 Implement `undo_write` tool (`tools/undo.ts`) — accepts `{ operationId? }` or `{ path? }`, delegates to `UndoStack`, invalidates hash cache
- [ ] 3.4 Implement search tools (`tools/search.ts`) — `search_text` (with search hash cache), `find_files`; port Myers diff walk from old `workflow/tools.ts`
- [ ] 3.5 Implement shell tool (`tools/shell.ts`) — `run_command` free-form, NEVER description, `spawnSync` with cwd, 15s timeout, 8KB output cap
- [ ] 3.6 Implement web tools (`tools/web.ts`) — port `fetch_url` and `search_internet` from old `workflow/tools.ts`
- [ ] 3.7 Implement board tools wrapper (`tools/common.ts`) — wrap `COMMON_TOOL_DEFINITIONS` + `executeCommonTool` into Pi `defineTool()` instances
- [ ] 3.8 Implement `buildPiTools(ctx, harnessCtx, toolGroups)` in `tools/index.ts` — expands group names, returns `defineTool[]` array

## 4. Pi Engine Core

- [ ] 4.1 Implement `PiSessionManager` (`session-manager.ts`) — `Map<conversationId, AgentSession>`, `getOrCreate(conversationId, worktreePath, config)`, `dispose(conversationId)`
- [ ] 4.2 Implement event translator (`event-translator.ts`) — translate Pi SDK events to `EngineEvent`; on `compaction_start` call `hashCache.resetWindowFlags()`; extract `writtenFiles` from write tool results
- [ ] 4.3 Implement `PiEngine` class (`engine.ts`) — implements `ExecutionEngine`, wires `PiSessionManager` + `HarnessContext` + event translator, `execute()` returns `AsyncIterable<EngineEvent>`
- [ ] 4.4 Register `PiEngine` factory in `src/bun/index.ts` `engineFactories` map

## 5. Integration

- [ ] 5.1 Verify tool groups work end-to-end with a minimal workflow YAML column config (`tools: [read, write, shell]`)
- [ ] 5.2 Verify session reuse — second `execute()` on same `conversationId` reuses the Pi session
- [ ] 5.3 Verify hash cache — second `read_file` on unchanged file returns `[unchanged]` marker
- [ ] 5.4 Verify undo stack — `write_file` then `undo_write` restores original content
- [ ] 5.5 Verify compaction boundary — hash cache `seenInWindow` resets on compaction event
- [ ] 5.6 Verify `worktree` lifecycle — session disposed when task is archived
- [ ] 5.7 Write backend unit tests for `ContentHashCache` and `UndoStack` classes
- [ ] 5.8 Write backend unit tests for `PiEngine.execute()` using a mock Pi session
