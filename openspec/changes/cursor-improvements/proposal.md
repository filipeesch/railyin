## Why

The Cursor SDK engine was added with correct structural plumbing but is missing three behaviors that the Copilot engine already delivers:

1. **Edit tool output is unreadable.** The Cursor SDK's built-in `Edit` tool returns a structured object `{ status, value: { linesAdded, linesRemoved, diffString } }`. The current `normalizeCursorToolResult` falls through to `JSON.stringify`, so the UI shows a raw JSON blob instead of a rendered file diff. No `writtenFiles` metadata is produced, so `stream-processor` never emits `file_diff` blocks.

2. **Slash commands are silently swallowed.** The Cursor engine has no `SlashCommandDialect`. When a user types `/opsx-explore some idea`, the string is sent verbatim to the Cursor SDK backend instead of being resolved to the content of `.github/prompts/opsx-explore.prompt.md`. The SDK doesn't know what `/opsx-explore` means, so the agent ignores the instruction.

3. **Available commands are never listed.** `CursorEngine.listCommands()` always returns `[]` (the adapter stub is hard-coded to empty). The UI never shows slash command suggestions in the Cursor context.

## What Changes

- **`worker.mjs`**: Special-case Edit/Write/MultiEdit tool results — normalize `result` to human-readable text (`"N lines added, M removed"`) and set `detailedResult = diffString` on the emitted `EngineEvent`.
- **`events.ts`**: Mirror the same changes to keep both normalization copies in sync.
- **`engine.ts`**: Three additions:
  - Inject `CopilotDialect` (as `SlashCommandDialect`) into the constructor; call `dialect.resolvePrompt()` before composing the user prompt.
  - Implement `listCommands()` using the dialect, mirroring Copilot's DB-lookup pattern.
  - Track `callId → { name, args }` from `tool_start` events; synthesize `writtenFiles` on `tool_result` for Edit/Write/MultiEdit tools using the tracked path + `detailedResult` as `rawDiff`.
- **`adapter.ts`** + **`worker-client.ts`**: Remove `listCommands` from the `CursorSdkAdapter` interface and its no-op implementation (dead code — engine now owns command discovery).

## Non-Goals

- Implementing Cursor-specific slash command conventions (`.cursor/commands/` etc.) — Cursor uses the same `.github/prompts/` directory as Copilot.
- Server-side diff parsing for Cursor (the UI already handles `rawDiff` via `parseUnifiedDiff`).
- Adding skills (SKILL.md) injection — Pi-specific feature, not part of Copilot or Cursor engines.
- Changes to the worker IPC protocol types (no new fields in `BunToWorker`/`WorkerToBun`; `detailedResult` already exists on `EngineEvent`).

## Impact

| File | Change |
|---|---|
| `src/bun/engine/cursor/worker.mjs` | Edit/Write result normalization + `detailedResult` |
| `src/bun/engine/cursor/events.ts` | Mirror worker changes |
| `src/bun/engine/cursor/engine.ts` | Dialect, resolvePrompt, listCommands, writtenFiles |
| `src/bun/engine/cursor/adapter.ts` | Remove `listCommands` from interface |
| `src/bun/engine/cursor/worker-client.ts` | Remove no-op `listCommands` |
