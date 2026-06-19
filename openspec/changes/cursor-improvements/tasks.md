## 1. worker.mjs — normalize Edit/Write tool results

- [x] 1.1 Add `normalizeBuiltinToolResult(name, rawResult)` helper in `src/bun/engine/cursor/worker.mjs` that:
  - For `Edit`/`MultiEdit`: extracts `linesAdded`, `linesRemoved`, `diffString` from `rawResult?.value`; returns `{ result: "N lines added, M removed", detailedResult: diffString }`
  - For `Write`: extracts `linesCreated` from `rawResult?.value`; returns `{ result: "File written (N lines)" }`
  - Fallback: calls existing `normalizeCursorToolResult(name, rawResult)` for the text, returns `{ result: text }`
- [x] 1.2 Update `translateCursorMessage` in `worker.mjs`: in the `tool_call` / `status === "completed"` branch, replace the call to `normalizeCursorToolResult` with `normalizeBuiltinToolResult`, and spread `detailedResult` onto the emitted event when present

## 2. events.ts — mirror worker changes

- [x] 2.1 Add the same `normalizeBuiltinToolResult(name, rawResult)` helper in `src/bun/engine/cursor/events.ts` (identical logic to 1.1 — kept in sync manually since worker cannot import TypeScript)
- [x] 2.2 Update `translateCursorMessage` in `events.ts` to call `normalizeBuiltinToolResult` and spread `detailedResult` onto emitted events, matching worker change 1.2

## 3. engine.ts — dialect injection, resolvePrompt, writtenFiles, listCommands

- [x] 3.1 Import `CopilotDialect` and `SlashCommandDialect` in `src/bun/engine/cursor/engine.ts`
- [x] 3.2 Add `private readonly dialect: SlashCommandDialect` field and extend the constructor to accept `dialect: SlashCommandDialect = new CopilotDialect()` as a fourth parameter (after `adapter`)
- [x] 3.3 In `_run()`, call `await this.dialect.resolvePrompt(prompt, workingDirectory ?? "")` before building `composedPrompt`; use the resolved content in place of the raw `prompt`; yield a fatal error event and return on failure
- [x] 3.4 In `_run()`, declare `const toolArgsByCallId = new Map<string, { name: string; args: Record<string, unknown> }>()` before the event loop
- [x] 3.5 In the event loop, on `tool_start` with a `callId`: parse `event.arguments` as JSON and store `{ name: event.name, args }` in `toolArgsByCallId`
- [x] 3.6 Add module-level helper `maybeAddWrittenFiles(event: ToolResultEvent, tracked?: { name: string; args: Record<string, unknown> }): EngineEvent` that:
  - Returns `event` unchanged if `tracked` is absent or tool name is not Edit/Write/MultiEdit
  - Parses `added`/`removed` counts from `event.result` (e.g. `"3 lines added, 1 removed"`)
  - Builds `writtenFiles: [{ operation: "edit_file" | "write_file", path, added, removed, ...(rawDiff ? { rawDiff } : {}) }]`
  - Returns `event` with `writtenFiles` attached
- [x] 3.7 In the event loop, on `tool_result` with a `callId`: look up and delete from `toolArgsByCallId`, call `maybeAddWrittenFiles`, yield the enriched event
- [x] 3.8 Implement `listCommands(taskId: number)` in `CursorEngine` mirroring `CopilotEngine.listCommands()`: DB lookup for `board_id` → `project_key` → `projectPath`, then `task_git_context` for `worktreePath`; return `this.dialect.listCommands(worktreePath, projectPath)`

## 4. adapter.ts + worker-client.ts — remove dead listCommands

- [x] 4.1 Remove `listCommands` method signature from the `CursorSdkAdapter` interface in `src/bun/engine/cursor/adapter.ts`
- [x] 4.2 Remove `listCommands` implementation from `SubprocessCursorAdapter` in `src/bun/engine/cursor/worker-client.ts`
- [x] 4.3 Remove any call sites in `engine.ts` that delegate to `this.adapter.listCommands(...)` (replaced by 3.8)
