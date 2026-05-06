## Context

Railyin currently has three engines: `CopilotEngine`, `ClaudeEngine`, and `OpenCodeEngine`. Each lives in `src/bun/engine/{name}/` and implements the `ExecutionEngine` interface (`execute()→AsyncIterable<EngineEvent>`, `resume()`, `cancel()`, `listModels()`, `listCommands()`). Engines are registered in `src/bun/index.ts` `engineFactories` map and configured via `engines.yaml`.

The old `NativeEngine` (removed in commit `685c543`) used a callback-based provider loop with a hand-rolled tool set in `src/bun/workflow/tools.ts`. That tool set (read_file, write_file, patch_file, delete_file, rename_file, list_dir, search_text, find_files, run_command, fetch_url, search_internet) had no undo capability and no content hash optimization.

Pi SDK (`@mariozechner/pi-coding-agent`) provides: managed agentic loop, JSONL session trees, compaction, model-agnostic routing (OpenAI-compatible endpoints — LM Studio, Ollama, etc.), and a `defineTool()` API for fully custom tool injection.

## Goals / Non-Goals

**Goals:**
- Implement `PiEngine` as a first-class Railyin engine using Pi SDK
- Revive and own the full native tool set (hide all Pi built-ins)
- Add content hash cache to prevent redundant file/search content in context
- Add `undo_write` tool with operationId and path-based addressing
- Keep tool descriptions imperative (NEVER/ALWAYS) so weak models follow constraints
- Support workflow YAML tool group configuration (same as other engines)

**Non-Goals:**
- `spawn_agent` tool (deferred to task #383)
- Web tool improvements — fetch_url/search_internet ship as v1 (deferred to task #384)
- Making harness features engine-agnostic (Pi-specific only by decision)
- Allowlist/denylist for shell commands (description-only enforcement by decision)

## Decisions

All decisions are recorded in the task decision log. Key ones:

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Tool injection | `customTools: [ourTools]`, `tools: []` | Full control, hide Pi built-ins |
| Hash cache scope | Per-conversation (Pi session lifetime) | Clean isolation; reset `seenInWindow` on compaction |
| Undo trigger | Explicit `undo_write` tool | Model already has `op:XXXX` in the result string — no memory required |
| Session storage | File-based JSONL (`SessionManager.create(worktreePath)`) | Pi compaction/branching works; survives restarts |
| Session keying | `Map<conversationId, AgentSession>` | 1:1 Railyin conversation = Pi session; no cross-task leakage |
| Harness instructions | In tool descriptions only (NEVER/ALWAYS) | Consistent with common-tools pattern; no extra system prompt |
| Shell format | Free-form string, no denylist | Weak models know shell syntax; description enforces read-only usage |

## Architecture

```
PiEngine
  ├── SessionManager  (conversationId → AgentSession, JSONL on disk)
  ├── HarnessContext  (per-session: ContentHashCache + UndoStack)
  └── Pi AgentSession
        ├── tools: []           (all Pi built-ins disabled)
        └── customTools: [...]  (all Railyin tools)
              ├── read tools    (read_file, list_dir + hash cache)
              ├── write tools   (write_file, patch_file, delete_file, rename_file + undo)
              ├── undo tool     (undo_write)
              ├── search tools  (search_text, find_files + hash cache)
              ├── shell tool    (run_command, free-form)
              ├── web tools     (fetch_url, search_internet)
              └── board tools   (wraps common-tools.ts)
```

### File Structure

```
src/bun/engine/pi/
  engine.ts              ← PiEngine implements ExecutionEngine
  config.ts              ← PiEngineConfig type
  event-translator.ts    ← Pi SDK events → EngineEvent
  session-manager.ts     ← conversationId → AgentSession lifecycle
  harness/
    context.ts           ← HarnessContext interface (DI root)
    hash-cache.ts        ← ContentHashCache class
    undo-stack.ts        ← UndoStack class
  tools/
    index.ts             ← buildPiTools(ctx, harnessCtx) → defineTool[]
    read.ts              ← read_file, list_dir
    write.ts             ← write_file, patch_file, delete_file, rename_file
    undo.ts              ← undo_write
    search.ts            ← search_text, find_files
    shell.ts             ← run_command
    web.ts               ← fetch_url, search_internet
    common.ts            ← wraps COMMON_TOOL_DEFINITIONS + executeCommonTool
```

### ContentHashCache

```typescript
interface CacheEntry { hash: string; seenInWindow: boolean; turnNumber: number }
Map<filePath, CacheEntry>

// Read flow:
// hash unchanged + seenInWindow=true → "[unchanged since turn N]"
// hash changed OR not seen → send full content, update entry
// On write to path → delete entry (invalidate)
// On compaction_start → set all seenInWindow = false (keep hash)
```

### UndoStack

```typescript
interface WriteSnapshot {
  operationId: string;    // "a3f9" — 4-char hex from crypto.randomBytes
  path: string;
  type: "write_file" | "patch_file" | "delete_file" | "rename_file";
  beforeContent: string | null;  // null = file didn't exist before (undo = delete)
  toPath?: string;               // rename_file only
}
// Cap: 50 entries FIFO. Addressable by operationId or path (most recent match).
```

### Event Translation

```
Pi event                    → EngineEvent
────────────────────────────────────────────────────────
message_update(text_delta)  → { type: "token", text }
message_update(thinking_delta) → { type: "reasoning", text }
tool_execution_start        → { type: "tool_start", name, input }
tool_execution_end          → { type: "tool_result", name, output, writtenFiles? }
compaction_start            → side-effect: hashCache.resetWindowFlags()
agent_end                   → { type: "done" }
error                       → { type: "error", message }
```

`writtenFiles` is populated from `WriteResult.diff` when write tools execute — preserves existing diff viewer UI.

### Tool Groups (workflow YAML)

Mirrors the old native engine's `TOOL_GROUPS`:
```yaml
tools:
  - read       # read_file, list_dir
  - write      # write_file, patch_file, delete_file, rename_file, undo_write
  - search     # search_text, find_files
  - shell      # run_command
  - web        # fetch_url, search_internet
  - board      # common-tools (get_task, list_tasks, etc.)
  - interactions # ask_user
```

### PiEngineConfig shape

```yaml
engines:
  - id: pi-local
    type: pi
    model: lmstudio/qwen3-8b   # optional; overridable per-task
    providers:
      lmstudio:
        base_url: http://localhost:1234/v1
    harness:
      undo_stack_size: 50        # optional, default 50
```

## Risks / Trade-offs

- **Pi SDK is not yet installed**: `@mariozechner/pi-coding-agent` must be added to `package.json` before any code compiles. Verify API stability before depending on it.
- **Two session stores**: Pi JSONL on disk + Railyin SQLite. If a worktree is deleted, Pi session files must be cleaned up too (add to worktree teardown).
- **Token usage not in Pi events**: Pi may not emit token counts in events — the `done` EngineEvent's `usage` field may be empty or require inspecting `session.agent.state.messages` directly.
- **Weak model slop**: Description-only shell enforcement relies on the model following NEVER/ALWAYS instructions. Qwen3-8b generally follows these but is not guaranteed. This is an acceptable v1 trade-off.
- **search_text hash cache granularity**: Cache key includes pattern+glob+context_lines + hash of all matching file contents. Any file change in the glob scope invalidates the entire search result — may cause unnecessary re-searches on large codebases. Acceptable for v1.
