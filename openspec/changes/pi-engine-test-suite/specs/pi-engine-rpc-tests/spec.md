## ADDED Requirements

### Requirement: MockPiSdkAdapter support file
The test suite SHALL provide `src/bun/test/support/pi-sdk-mock.ts` implementing `PiSdkAdapter` interface with scripted turn execution. The mock SHALL follow the same `queueCreate` / `queueResume` pattern as `MockCopilotSdkAdapter`.

#### Scenario: Mock queues scripted turns for create
- **WHEN** `mockAdapter.queueCreate(session)` is called before `PiEngine.execute()`
- **THEN** the engine receives the scripted `MockPiSession` and emits its queued turn events

#### Scenario: Mock queues scripted turns for resume
- **WHEN** `mockAdapter.queueResume(session)` is called before `PiEngine.resume()`
- **THEN** the engine resumes with the scripted session

### Requirement: EventTranslator unit test coverage
The test suite SHALL cover `EventTranslator` Pi-to-Railyin event mapping in `src/bun/test/pi-events.test.ts`. `HarnessContext` is injected as a mock/stub.

#### Scenario: EV-1 text_delta maps to stream_text EngineEvent
- **WHEN** Pi emits `{ type: "text_delta", content: "hello" }`
- **THEN** `EventTranslator` emits `{ type: "stream_text", content: "hello" }`

#### Scenario: EV-2 tool_call maps to tool_start EngineEvent
- **WHEN** Pi emits `{ type: "tool_call", name: "read_file", args: {...} }`
- **THEN** emits `{ type: "tool_start", toolName: "read_file", args: {...} }`

#### Scenario: EV-3 tool_result maps to tool_end EngineEvent
- **WHEN** Pi emits `{ type: "tool_result", name: "read_file", result: "content" }`
- **THEN** emits `{ type: "tool_end", toolName: "read_file", result: "content" }`

#### Scenario: EV-4 turn_end maps to done EngineEvent
- **WHEN** Pi emits `{ type: "turn_end" }`
- **THEN** emits `{ type: "done" }`

#### Scenario: EV-5 error maps to error EngineEvent
- **WHEN** Pi emits `{ type: "error", message: "timeout" }`
- **THEN** emits `{ type: "error", message: "timeout" }`

#### Scenario: EV-6 compaction_start resets HarnessContext seenInWindow flags
- **WHEN** Pi emits `{ type: "compaction_start" }`
- **THEN** `harnessContext.hashCache.resetWindow()` is called
- **AND** the compaction event is NOT emitted as a Railyin EngineEvent (internal only)

#### Scenario: EV-7 unknown Pi event is ignored without throwing
- **WHEN** Pi emits an unrecognized event type
- **THEN** no EngineEvent is emitted and no exception is thrown

### Requirement: PiSessionManager integration test coverage
The test suite SHALL cover session lifecycle in `src/bun/test/pi-session-manager.test.ts`.

#### Scenario: SM-1 Create creates new session keyed by conversationId
- **WHEN** `sessionManager.getOrCreate(conversationId, worktreePath)` is called
- **THEN** a session is stored under that conversationId
- **AND** a JSONL session file is created in the worktree path

#### Scenario: SM-2 Same conversationId returns existing session
- **WHEN** `getOrCreate` is called twice with the same conversationId
- **THEN** the same session object is returned both times

#### Scenario: SM-3 Destroy removes session from map
- **WHEN** `sessionManager.destroy(conversationId)` is called
- **THEN** the session is removed and the next `getOrCreate` creates a fresh session

#### Scenario: SM-4 HarnessContext is created fresh per session
- **WHEN** two sessions are created for different conversationIds
- **THEN** each has an independent `ContentHashCache` and `UndoStack` instance

### Requirement: Pi engine RPC scenario test coverage
The test suite SHALL cover `PiEngine` end-to-end in `src/bun/test/pi-rpc-scenarios.test.ts` using `BackendRpcRuntime` with `MockPiSdkAdapter`. All scenarios from `shared-rpc-scenarios.ts` SHALL be called for Pi as they are for Copilot and Claude.

#### Scenario: RPC-1 Pi engine runs shared RPC scenarios
- **WHEN** `runSharedRpcScenarios(runtime)` is called with a Pi-backed `BackendRpcRuntime`
- **THEN** all shared scenarios pass (stream events, message persistence, cancellation, resume)

#### Scenario: RPC-2 Pi engine write-then-undo flow persists correct file state
- **WHEN** the scripted session emits `write_file("a.ts", "v1")` then `undo_write({ path: "a.ts" })`
- **THEN** `a.ts` is absent or restored to pre-write state after execution completes

#### Scenario: RPC-3 Pi engine [unchanged] suppression is reflected in stream events
- **WHEN** the scripted session emits `read_file("a.ts")` twice for unchanged content
- **THEN** the second `tool_result` event contains `[file unchanged since turn N]`
- **AND** the stream event is persisted to the DB with that result

### Requirement: Pi tool group expansion test coverage
The test suite SHALL cover `buildPiTools` group resolution in `src/bun/test/pi-tool-groups.test.ts`.

#### Scenario: TG-1 No column config returns default tool set
- **WHEN** `buildPiTools(ctx, harnessCtx, undefined)` is called
- **THEN** the returned array includes tools from `read`, `write`, `search`, `shell` groups

#### Scenario: TG-2 Column with ["read", "search"] returns only those groups
- **WHEN** `buildPiTools(ctx, harnessCtx, ["read", "search"])` is called
- **THEN** result includes `read_file`, `glob`, `search_text` but NOT `write_file` or `run_command`

#### Scenario: TG-3 Board and interaction tools are always included
- **WHEN** any column config is passed (even `["shell"]` only)
- **THEN** board tools and `ask_me` are always present in the returned array

#### Scenario: TG-4 Unknown group name is ignored without error
- **WHEN** `buildPiTools(ctx, harnessCtx, ["read", "nonexistent"])` is called
- **THEN** returns read-group tools without throwing

#### Scenario: TG-5 All tool definitions are valid Pi defineTool objects
- **WHEN** `buildPiTools` is called with full default config
- **THEN** every element has `name`, `description`, `parameters`, and `execute` function

#### Scenario: TG-6 read_file description contains NEVER re-read instruction
- **WHEN** `buildPiTools` returns the `read_file` tool definition
- **THEN** its description contains `[unchanged` reference and a NEVER clause for unnecessary re-reads

#### Scenario: TG-7 run_command description contains NEVER file-write clause
- **WHEN** `buildPiTools` returns the `run_command` tool definition
- **THEN** its description contains `NEVER` and references to `write_file`/`patch_file` as alternatives
