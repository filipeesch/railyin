## Context

The Cursor engine (`src/bun/engine/cursor/`) uses a Node.js subprocess (`worker.mjs`) to host the `@cursor/sdk` because Bun's HTTP/2 client has a bug with large streaming frames. The Bun parent (`engine.ts`) talks to the worker via line-delimited JSON. The worker translates raw SDK messages into `EngineEvent` shapes; the engine post-processes them (adding `display` to `tool_start`) and yields them to `stream-processor`.

The Copilot engine (`src/bun/engine/copilot/`) is the reference implementation. It:
1. Holds a `CopilotDialect` for slash command discovery and resolution
2. Calls `dialect.resolvePrompt()` on the raw prompt before sending to the SDK session
3. Produces `writtenFiles: FileDiffPayload[]` on `tool_result` events for edit/write tools
4. Implements `listCommands()` via DB lookup + `dialect.listCommands()`

The Cursor engine is missing all of these behaviors.

## Goals / Non-Goals

**Goals:**
- Cursor engine resolves `/command` references to `.github/prompts/*.prompt.md` content before sending to the SDK
- `listCommands()` returns available slash commands for the worktree/project
- Edit and Write tool results show a rendered file diff in the chat instead of a raw JSON blob
- Adapter interface is cleaned up (remove dead `listCommands` stub)

**Non-Goals:**
- Changing the IPC protocol wire types (`BunToWorker`/`WorkerToBun`)
- Server-side unified diff parsing (UI already parses `rawDiff`)
- Skills (SKILL.md) injection — not part of Copilot/Cursor pattern
- New Cursor-specific dialect class (Cursor uses identical convention to Copilot)

## Decisions

### 1. Use `CopilotDialect` directly in `CursorEngine`

`CopilotDialect` discovers and resolves `.github/prompts/*.prompt.md` files — the same convention Cursor's SDK uses for local agents. No `CursorDialect` wrapper is needed. The constructor accepts `SlashCommandDialect` as an interface (for testability) with `CopilotDialect` as the default.

### 2. Worker sends `detailedResult` for Edit/Write tool results

The Cursor SDK's `Edit` built-in returns `{ status: "success", value: { linesAdded?, linesRemoved?, diffString? } }`. The `Write` built-in returns `{ status: "success", value: { path, linesCreated, fileSize } }`.

Rather than passing the raw JSON to the engine and re-parsing there, the worker normalizes:
- `result` → human-readable: `"3 lines added, 1 removed"` (Edit) / `"File written (10 lines)"` (Write)
- `detailedResult` → `diffString` when available (Edit only)

The `EngineEvent` type already has `detailedResult?: string`, so `EventMessage` (which wraps `EngineEvent`) carries this without any protocol change.

### 3. Engine tracks `callId → args` for writtenFiles synthesis

The `tool_start` event carries the tool name and arguments (including the `path`). The `tool_result` event carries the name and normalized result but not the args. The engine maintains a `Map<callId, { name: string; args: Record<string, unknown> }>` that is populated on `tool_start` and consumed on `tool_result`.

For Edit/Write/MultiEdit tools, the engine builds:
```typescript
writtenFiles: [{
  operation: "edit_file" | "write_file",
  path: trackedArgs.args.path as string,
  added: parsedCount.added,
  removed: parsedCount.removed,
  ...(diffString ? { rawDiff: diffString } : {}),
}]
```

The UI's `StreamBlockNode.vue` already handles `rawDiff` via `parseUnifiedDiff()` — no changes needed there.

### 4. Remove `listCommands` from `CursorSdkAdapter`

The adapter's `listCommands` always returned `[]`. Now that the engine implements it via dialect, the method is dead code at the adapter level. Removing it from the interface shrinks the contract and removes the need to implement it in test mocks.

## Implementation Flow

```
                     ┌── CursorEngine._run() ────────────────────────────────┐
                     │                                                        │
User prompt          │  dialect.resolvePrompt(prompt, workingDirectory)       │
"/opsx-explore ..."  │       ↓ CopilotDialect reads                          │
─────────────────────▶  .github/prompts/opsx-explore.prompt.md               │
                     │       ↓ returns XML-wrapped content                   │
                     │  composedPrompt = systemBlock + taskBlock +            │
                     │                  bypassNotice + resolvedContent        │
                     │       ↓                                               │
                     │  adapter.run(runConfig)                               │
                     │       ↓ Cursor SDK executes                           │
                     │                                                        │
                     │  SDK fires built-in Edit tool                         │
                     │  ┌── worker.mjs translateCursorMessage() ──────────┐  │
                     │  │  name="Edit", status="completed"                │  │
                     │  │  result={status:"success",value:{               │  │
                     │  │    linesAdded:3, linesRemoved:1,                │  │
                     │  │    diffString:"@@ -10,3 +10,5 @@\n..."}}        │  │
                     │  │  ↓ special-case Edit result                     │  │
                     │  │  event.result = "3 lines added, 1 removed"      │  │
                     │  │  event.detailedResult = "@@ -10,3 +10,5 @@\n..." │ │
                     │  └─────────────────────────────────────────────────┘  │
                     │       ↓                                               │
                     │  engine receives tool_result event                    │
                     │  ├── tool_start tracked: callId → {name:"Edit",      │
                     │  │                               args:{path:"src/f"}} │
                     │  └── builds writtenFiles: [{                          │
                     │          operation: "edit_file",                      │
                     │          path: "src/f",                               │
                     │          added: 3, removed: 1,                        │
                     │          rawDiff: "@@ -10,3 +10,5 @@\n..."           │
                     │      }]                                               │
                     │       ↓ yields tool_result + writtenFiles             │
                     └────────────────────────────────────────────────────────┘
                              ↓
                     stream-processor._emitFileDiffFromWrittenFiles()
                              ↓
                     file_diff block in conversation
                              ↓
                     UI: StreamBlockNode parseUnifiedDiff(rawDiff) → diff view ✓
```

```
                     ┌── CursorEngine.listCommands(taskId) ─────────────────┐
                     │  DB lookup: task → board → workspace → projectPath   │
                     │  DB lookup: task_git_context → worktreePath          │
                     │  dialect.listCommands(worktreePath, projectPath)     │
                     │  → scans .github/prompts/*.prompt.md                 │
                     │  → returns [{name:"opsx-explore", description:...}]  │
                     └────────────────────────────────────────────────────────┘
```

## File-Level Changes

### `src/bun/engine/cursor/worker.mjs`

In `translateCursorMessage`, within the `tool_call` / `completed` branch, detect Edit/Write results and emit enriched events:

```javascript
// After resolving resolvedName from mcp envelope:
if (message.status === "completed" || message.status === "error") {
  const isError = message.status === "error";
  const { result: rawText, detailedResult } = normalizeBuiltinToolResult(resolvedName, message.result);
  const result = rawText.length > 0 ? rawText : isError ? "(tool returned error)" : "(no output)";
  events.push({
    type: "tool_result", name: resolvedName, result,
    callId: message.call_id, isError,
    ...(detailedResult ? { detailedResult } : {}),
  });
}
```

Add `normalizeBuiltinToolResult(name, rawResult)` helper:
- For `Edit`/`MultiEdit`: extract `linesAdded`, `linesRemoved`, `diffString` from `value`; return `{ result: "N lines added, M removed", detailedResult: diffString }`
- For `Write`: extract `linesCreated`; return `{ result: "File written (N lines)" }`
- Fallback: call existing `normalizeCursorToolResult` for the text

### `src/bun/engine/cursor/events.ts`

Mirror the same `normalizeBuiltinToolResult` helper and update `translateCursorMessage` identically to keep both copies in sync.

### `src/bun/engine/cursor/engine.ts`

**Constructor**:
```typescript
constructor(
  onTaskUpdated: OnTaskUpdated,
  _onNewMessage: OnNewMessage,
  adapter: CursorSdkAdapter = createDefaultCursorSdkAdapter(),
  dialect: SlashCommandDialect = new CopilotDialect(),
) { ... }
```

**`_run()` — prompt resolution** (before `buildCursorTools`):
```typescript
let resolvedPrompt: string;
try {
  const resolved = await this.dialect.resolvePrompt(prompt, workingDirectory ?? "");
  resolvedPrompt = resolved.content;
} catch (err) {
  yield { type: "error", message: err instanceof Error ? err.message : String(err), fatal: true };
  return;
}
// Use resolvedPrompt instead of prompt when building composedPrompt
```

**`_run()` — callId tracking + writtenFiles**:
```typescript
const toolArgsByCallId = new Map<string, { name: string; args: Record<string, unknown> }>();

// In the event loop:
if (event.type === "tool_start" && event.callId) {
  let args: Record<string, unknown> = {};
  try { args = JSON.parse(event.arguments ?? "{}"); } catch {}
  toolArgsByCallId.set(event.callId, { name: event.name, args });
}

if (event.type === "tool_result" && event.callId) {
  const tracked = toolArgsByCallId.get(event.callId);
  toolArgsByCallId.delete(event.callId);
  const enriched = maybeAddWrittenFiles(event, tracked);
  if (enriched.type === "tool_start" && !enriched.display) { /* display path */ }
  yield enriched;
  continue;
}
```

Add `maybeAddWrittenFiles(event, tracked)` helper (private or module-level) that builds `writtenFiles` for Edit/Write/MultiEdit.

**`listCommands(taskId)`** — mirror Copilot exactly:
```typescript
async listCommands(taskId: number): Promise<CommandInfo[]> {
  const { getDb } = await import("../../db/index.ts");
  // ... same DB lookup pattern as CopilotEngine.listCommands()
  return this.dialect.listCommands(worktreePath, projectPath);
}
```

### `src/bun/engine/cursor/adapter.ts`

Remove `listCommands` from `CursorSdkAdapter` interface.

### `src/bun/engine/cursor/worker-client.ts`

Remove `listCommands` method from `SubprocessCursorAdapter`.
