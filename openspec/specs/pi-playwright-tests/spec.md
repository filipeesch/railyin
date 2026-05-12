# Pi Playwright Tests

## Purpose

Playwright scenario coverage for Pi-specific tool result rendering in the UI. Tests use the existing WebSocket mock injection — no real Bun server required.

## Requirements

### Requirement: Pi tool result rendering scenarios in Playwright suite
The test suite SHALL add 3 Playwright scenarios to `e2e/ui/tool-rendering.spec.ts` covering Pi-specific tool result display. Tests use the existing `mock-api.ts` WebSocket mock injection (no real Bun server).

#### Scenario: S-28 undo_write tool result renders success message
- **WHEN** a WebSocket `stream.event` with `tool_end` for `undo_write` is injected with result `"Reverted write to a.ts (op:a3f9)"`
- **THEN** the tool result card shows the undo confirmation text in the conversation

#### Scenario: S-29 op:XXXX in write_file result is visible in tool result card
- **WHEN** a WebSocket `stream.event` with `tool_end` for `write_file` is injected with result containing `"op:a3f9"`
- **THEN** the tool result card displays the operationId string without truncation

#### Scenario: S-30 [unchanged] result renders as suppressed-content indicator
- **WHEN** a WebSocket `stream.event` with `tool_end` for `read_file` is injected with result `"[file unchanged since turn 3 — use your cached version]"`
- **THEN** the tool result card renders the unchanged marker text
- **AND** no file content is shown (the card body is not blank — the marker is the content)

### Requirement: Pi tool harness provides the full native tool set via Pi defineTool
The system SHALL provide a `buildPiTools(commonCtx, harnessCtx, columnGroups?)` function at `src/bun/engine/pi/tools/index.ts` that returns an array of Pi `defineTool`-compatible tool definitions. The harness SHALL include: `read_file`, `glob`, `write_file`, `patch_file`, `delete_file`, `rename_file`, `undo_write`, `search_text`, `run_command`, `fetch_url`, `search_internet`, and all tools from `common-tools.ts` (board + ask_user). All tool descriptions SHALL follow the NEVER/ALWAYS imperative pattern. The `columnGroups` parameter (optional string array) filters which tool groups are included; omitting it returns the default set. Board and interaction tools are always included regardless of `columnGroups`.

#### Scenario: All tools are returned as Pi-compatible definitions
- **WHEN** `buildPiTools(ctx, harnessCtx)` is called with no column config
- **THEN** the returned array contains all Railyin harness tools as `defineTool` objects consumable by `createAgentSession({ customTools: [...] })`

#### Scenario: read_file description includes unchanged-marker instruction
- **WHEN** the model receives the `read_file` tool definition
- **THEN** the description includes guidance that `[unchanged since last read]` means the cached version is current and the model MUST NOT call read_file again for the same file

#### Scenario: write_file description includes undo instruction
- **WHEN** the model receives the `write_file` tool definition
- **THEN** the description instructs the model to save the `op:XXXX` from the result and pass it to `undo_write` if it needs to revert

#### Scenario: run_command description prohibits file writes
- **WHEN** the model receives the `run_command` tool definition
- **THEN** the description contains a NEVER clause prohibiting use of `run_command` to write or edit files, and directs the model to use `write_file` and `patch_file` instead

### Requirement: Compaction E2E tests — gauge refresh and error state
The test suite SHALL add two Playwright tests to `e2e/ui/extended-chat.spec.ts` Suite R, using the existing `api.handle()` mock infrastructure and WebSocket push helper.

#### Scenario: R-24 gauge drops immediately after successful compact
- **GIVEN** `conversations.contextUsage` returns `{ fraction: 0.9 }` on the first call and `{ fraction: 0.2 }` on subsequent calls
- **AND** `tasks.compact` mock pushes `message.new` with a `compaction_summary` message after 50 ms
- **AND** `models.listEnabled` returns a model with `supportsManualCompact: true`
- **WHEN** the user opens the task drawer, opens the context popover, and clicks "Compact"
- **THEN** the `.ctx-popover__pct` element updates from `"90%"` to `"20%"` within 5 seconds

#### Scenario: R-25 already-compacting error is visible after failed compact
- **GIVEN** `tasks.compact` mock throws (or returns a 500) with message `"Compaction already in progress"`
- **AND** `models.listEnabled` returns a model with `supportsManualCompact: true`
- **WHEN** the user clicks "Compact"
- **THEN** an error notification or toast is visible in the page within 3 seconds
