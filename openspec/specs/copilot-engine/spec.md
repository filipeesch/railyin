## Purpose
Defines the CopilotEngine implementation that wraps the GitHub Copilot SDK as an ExecutionEngine. Manages session lifecycle, event translation, authentication, tool registration, and model listing for the Copilot engine type.
## Requirements
### Requirement: CopilotEngine wraps the Copilot SDK as an ExecutionEngine
The system SHALL implement `CopilotEngine` conforming to the `ExecutionEngine` interface. It SHALL use `@github/copilot-sdk` to create agentic sessions, translate SDK events to `EngineEvent` types, and manage session lifecycle.

#### Scenario: CopilotEngine instantiates from config
- **WHEN** `workspace.yaml` has `engine.type: copilot`
- **THEN** a `CopilotEngine` instance is created and ready to accept `execute()` calls

#### Scenario: execute() creates a Copilot session and yields events
- **WHEN** `CopilotEngine.execute(params)` is called
- **THEN** a new `CopilotSession` is created, the prompt is sent via `session.send()`, and SDK events are translated to `EngineEvent` and yielded to the caller

#### Scenario: cancel() disconnects the active session
- **WHEN** `CopilotEngine.cancel(executionId)` is called
- **THEN** the session associated with that execution is disconnected and the engine yields an error or done event

### Requirement: Copilot SDK events are translated to EngineEvent types
The system SHALL translate Copilot SDK streaming events to the `EngineEvent` discriminated union. The Copilot adapter SHALL preserve enough SDK metadata for the conversation layer to render rich user-facing tool activity and suppress non-user-facing internal activity:
- `assistant.message_delta` → `{ type: "token" }`
- `assistant.thinking_delta` → `{ type: "reasoning" }`
- `tool.execution_start` → `{ type: "tool_start" }`
- `tool.execution_complete` → `{ type: "tool_result" }`, including structured `writtenFiles` when the tool changed files
- `tool.execution_partial_result` → `{ type: "status" }` only for non-internal tools, with truncated content
- `tool.execution_progress` → `{ type: "status" }` only for non-internal tools, with truncated content
- `session.complete` → `{ type: "done" }`
- `session.error` → `{ type: "error" }`

The `translateEvent()` function SHALL look up `toolCallId` from `tool.execution_partial_result` and `tool.execution_progress` events in `toolMetaByCallId` and suppress status events for tools marked as internal. For non-internal tools, the status message SHALL be truncated to a single summary line of at most 120 characters, using the last non-empty line of the output and prefixed with the tool name when available.

#### Scenario: Message delta translated to token event
- **WHEN** the SDK emits an `assistant.message_delta` event with content "Hello"
- **THEN** the engine yields `{ type: "token", content: "Hello" }`

#### Scenario: Tool execution events translated to tool events
- **WHEN** the SDK emits `tool.execution_start` for `editFile` then `tool.execution_complete`
- **THEN** the engine yields `{ type: "tool_start", name: "editFile", arguments: ... }` followed by `{ type: "tool_result", name: "editFile", result: ... }`

#### Scenario: Tool result translation preserves rich display content
- **WHEN** the SDK emits a `tool.execution_complete` event containing detailed or structured result content in addition to the concise LLM-facing text
- **THEN** the translated event keeps that richer content available to the conversation/UI layer

#### Scenario: Non-user-facing Copilot activity is not surfaced in the chat timeline
- **WHEN** the SDK identifies a message or tool-related event as hidden, internal, or otherwise non-user-facing through preserved metadata
- **THEN** that activity is not rendered as a visible conversation item

#### Scenario: User-facing tool execution still appears in order
- **WHEN** the SDK emits user-visible tool activity for a Copilot execution
- **THEN** the translated conversation items preserve the execution order needed by the timeline and remain visible in the chat UI

#### Scenario: Internal tool partial results are suppressed
- **WHEN** the SDK emits `tool.execution_partial_result` for a tool whose `toolCallId` maps to an internal tool in `toolMetaByCallId`
- **THEN** `translateEvent()` returns `null` and no status event is emitted

#### Scenario: Internal tool progress events are suppressed
- **WHEN** the SDK emits `tool.execution_progress` for a tool whose `toolCallId` maps to an internal tool in `toolMetaByCallId`
- **THEN** `translateEvent()` returns `null` and no status event is emitted

#### Scenario: Non-internal tool partial result is truncated to a summary line
- **WHEN** the SDK emits `tool.execution_partial_result` with multi-line `partialOutput` for a non-internal tool named `run_in_terminal`
- **THEN** the translated status message contains at most 120 characters, using the last non-empty line of output, prefixed with the tool name

#### Scenario: Session completion translated to done event
- **WHEN** the SDK emits `session.complete`
- **THEN** the engine yields `{ type: "done" }`

#### Scenario: Session error translated to error event
- **WHEN** the SDK emits `session.error` with message "Rate limited"
- **THEN** the engine yields `{ type: "error", message: "Rate limited" }`

#### Scenario: Copilot write tool completion emits structured written files
- **WHEN** a Copilot write-oriented tool completes successfully
- **THEN** the translated `tool_result` includes `writtenFiles` entries for the files changed by that tool call

### Requirement: Copilot engine authenticates via environment or CLI credentials
The system SHALL NOT require any authentication token in `workspace.yaml`. Authentication SHALL be handled entirely by the Copilot SDK's built-in auth chain: `COPILOT_GITHUB_TOKEN` env var, `GH_TOKEN` env var, `GITHUB_TOKEN` env var, stored OAuth from `copilot` CLI login, or `gh auth` credentials.

#### Scenario: Auth succeeds via environment variable
- **WHEN** `GITHUB_TOKEN` is set in the environment
- **THEN** the Copilot SDK authenticates using that token and the engine starts successfully

#### Scenario: Auth succeeds via CLI login
- **WHEN** no env vars are set but `copilot` CLI has stored OAuth credentials
- **THEN** the SDK authenticates using stored credentials and the engine starts successfully

#### Scenario: Auth failure reports error event
- **WHEN** no valid credentials are found by the SDK
- **THEN** the engine yields `{ type: "error", message: "...", fatal: true }` describing the auth failure

### Requirement: Copilot engine registers common tools as custom tools
The system SHALL register Railyin's common tools (task management) with the Copilot SDK using `defineTool()`. Each common tool's metadata (name, description, input schema) SHALL be converted to the SDK's Zod-based format.

#### Scenario: Common tools registered on session creation
- **WHEN** a new CopilotSession is created
- **THEN** all common tools are registered via `defineTool()` and available for the model to call

#### Scenario: Custom tool call executed by Railyin
- **WHEN** the Copilot model calls `create_task` (a custom tool)
- **THEN** the Copilot engine delegates to the common tool handler and returns the result to the SDK

#### Scenario: Built-in Copilot tools handled by SDK
- **WHEN** the Copilot model calls `editFile` or `runInTerminal` (built-in SDK tools)
- **THEN** the SDK executes them directly; the engine translates the resulting events to `EngineEvent`

### Requirement: Copilot engine passes stage_instructions as system message customization
The system SHALL pass column `stage_instructions` to the Copilot SDK via `systemMessage` configuration with `mode: "customize"`. The instructions SHALL be injected as a section override so they complement (not replace) Copilot's default system prompt.

#### Scenario: Stage instructions injected into Copilot session
- **WHEN** `ExecutionParams.systemInstructions` is "You are reviewing code for security issues"
- **THEN** the CopilotSession is configured with a system message section containing those instructions

#### Scenario: No stage instructions results in default Copilot system prompt
- **WHEN** `ExecutionParams.systemInstructions` is undefined
- **THEN** the CopilotSession uses the default Copilot system prompt without modification

### Requirement: Copilot engine session lifecycle is one session per active task lease
The system SHALL maintain a dedicated Copilot runtime lease per active task session identity. The lease SHALL be reused across resumable turns for the same task and SHALL be gracefully released when no task activity is observed for the configured inactivity window.

#### Scenario: Active task reuses same lease
- **WHEN** multiple resumable turns execute for the same task session ID
- **THEN** the engine reuses the same Copilot lease/runtime while the task remains active

#### Scenario: Inactive task lease is released
- **WHEN** no lease activity is observed for 10 consecutive minutes
- **THEN** the engine gracefully disconnects and releases that task's Copilot runtime lease

#### Scenario: Waiting-user lease still expires on inactivity
- **WHEN** a task is in waiting-user state with no lease activity for 10 minutes
- **THEN** the Copilot runtime lease is gracefully released

### Requirement: Copilot engine handles permission requests via events
The system SHALL handle Copilot SDK's `onPermissionRequest` callback by translating permission requests into `shell_approval` EngineEvents for shell commands. The orchestrator handles the approval flow — the engine resumes the session when approval is granted.

#### Scenario: Shell permission request translated to shell_approval event
- **WHEN** the SDK triggers `onPermissionRequest` for a shell command
- **THEN** the engine yields `{ type: "shell_approval", command: "npm test", executionId: ... }`

#### Scenario: Approved permission resumes execution
- **WHEN** the user approves a shell permission request
- **THEN** the engine signals the SDK to proceed and execution continues

#### Scenario: Denied permission returns tool error
- **WHEN** the user denies a shell permission request
- **THEN** the engine signals the SDK to deny and the SDK returns a tool error to the model

### Requirement: Copilot engine lists models available through GitHub Copilot
The `CopilotEngine.listModels()` method SHALL return the list of models available through the user's Copilot subscription. For Copilot model selection, the returned list SHALL prepend a synthetic `Auto` entry at index 0. The `Auto` entry SHALL use null model identity (`qualifiedId: null`) and SHALL include a description indicating that Copilot chooses the best available model based on task context, availability, and subscription access. If the SDK provides a model listing API, it SHALL be used for concrete models.

#### Scenario: Models returned from Copilot engine
- **WHEN** `listModels()` is called on the Copilot engine
- **THEN** it returns an array of `EngineModelInfo` with at least one model entry

#### Scenario: Auto entry is first and nullable
- **WHEN** `listModels()` returns results for Copilot
- **THEN** entry index 0 is `Auto`
- **AND** the entry has `qualifiedId = null`
- **AND** concrete models continue to use `qualifiedId` values prefixed with `copilot/`

#### Scenario: Auto entry includes behavior description
- **WHEN** `listModels()` returns the synthetic `Auto` entry
- **THEN** the entry includes description text explaining Copilot-managed model selection behavior

#### Scenario: Concrete model list includes model ID and display name
- **WHEN** `listModels()` returns concrete Copilot model results
- **THEN** each concrete entry includes at minimum a model-qualified ID and display name

### Requirement: Copilot engine config is minimal
The `engine.type: copilot` config block SHALL support an optional `model` field (string) for the default model to use. No other fields are required. The config SHALL NOT include API keys, base URLs, or provider lists.

#### Scenario: Minimal copilot config is valid
- **WHEN** `workspace.yaml` has `engine: { type: copilot }`
- **THEN** the engine starts with default settings

#### Scenario: Copilot config with model override
- **WHEN** `workspace.yaml` has `engine: { type: copilot, model: gpt-5 }`
- **THEN** the engine uses `gpt-5` as the default model for executions

### Requirement: Copilot engine isolates concurrent task executions into separate CLI processes
The system SHALL maintain a pool of Copilot CLI processes, one per active session ID. When a new session is created or resumed for a given session ID, the engine SHALL use a dedicated CLI process for that session ID. Concurrent sessions SHALL NOT share a CLI process.

#### Scenario: Two tasks execute concurrently without interference
- **WHEN** two task executions run at the same time, each with a different session ID
- **THEN** each execution uses its own CLI process and both complete successfully without timeout errors

#### Scenario: Same task resumed reuses existing pool entry
- **WHEN** a task's session is resumed and an active pool entry exists for its session ID
- **THEN** the engine reuses the existing CLI process (no new spawn) and resets the idle timer

#### Scenario: Same task resumed after pool entry evicted creates new CLI
- **WHEN** a task's session is resumed and the pool entry has been evicted (idle timeout)
- **THEN** the engine spawns a new CLI process, reconnects, and resumes from disk session state

### Requirement: Copilot engine recycles idle CLI processes to conserve resources
The system SHALL evaluate Copilot lease inactivity against a 10-minute timeout based on task activity timestamps. The timeout SHALL apply uniformly to running and waiting-user task leases. Access and runtime events for a lease SHALL refresh its activity timestamp.

#### Scenario: Idle Copilot runtime is stopped after 10 minutes without activity
- **WHEN** no activity is observed for a task lease for 10 consecutive minutes
- **THEN** the Copilot CLI process for that lease is stopped and lease resources are removed

#### Scenario: Lease remains while activity continues
- **WHEN** task activity is observed within each 10-minute window
- **THEN** the Copilot lease remains active and is not evicted

### Requirement: Copilot leases SHALL be gracefully closed during app exit
On app exit flow, all active Copilot task leases SHALL be asked to gracefully close before fallback hard termination.

#### Scenario: App exit closes all active Copilot leases
- **WHEN** app quit flow begins
- **THEN** the Copilot adapter attempts graceful closure for all active Copilot leases within a bounded deadline

#### Scenario: Startup does not kill Copilot runtimes
- **WHEN** the app starts
- **THEN** no startup path terminates Copilot runtimes as part of this capability

### Requirement: Copilot engine detects CLI process crashes and fails fast
The system SHALL verify CLI process health on each watchdog timeout by racing `client.ping()` against a 5-second timeout. If `ping()` fails or the 5-second timeout is reached, the execution SHALL fail immediately with a fatal error describing the CLI crash. It SHALL NOT wait for the next 120-second watchdog interval.

#### Scenario: CLI crash detected within 5 seconds of watchdog fire
- **WHEN** the 120s watchdog fires and the CLI process has crashed
- **THEN** `ping()` either rejects or the 5s timeout fires, and the execution yields a fatal error immediately

#### Scenario: Healthy CLI does not trigger immediate failure
- **WHEN** the 120s watchdog fires and `ping()` returns successfully within 5 seconds
- **THEN** no immediate error is emitted; the silence counter is incremented instead

### Requirement: Copilot engine detects permanently stuck sessions and surfaces an error
The system SHALL track a per-execution silence counter that increments each time the watchdog fires with a successful `ping()` result (CLI alive but no session events). When the counter reaches 3, the execution SHALL yield a fatal "session unresponsive" error. The counter SHALL reset to zero whenever a session event is received from the SDK.

#### Scenario: Session unresponsive error emitted after 3 silent watchdog cycles
- **WHEN** the 120s watchdog fires 3 consecutive times and `ping()` succeeds each time with no SDK session events in between
- **THEN** the execution yields `{ type: "error", message: "...", fatal: true }` describing an unresponsive session

#### Scenario: Silence counter resets on session event
- **WHEN** the watchdog has fired once (counter = 1) and then a session event arrives
- **THEN** the silence counter resets to 0 and the timer restarts as a fresh 120s window

#### Scenario: Silence counter resets between executions
- **WHEN** a new `execute()` call starts for the same task
- **THEN** the silence counter begins at 0 for that execution

### Requirement: CopilotEngine delivers text attachments to the model as selection attachments
The system SHALL map `Attachment` objects with a text media type (`text/*`, `application/json`, `application/yaml`) to Copilot SDK `selection` attachments. The mapped attachment SHALL include `filePath` pointing to a file that exists on disk containing the decoded text content, and SHALL also include the `text` field inline. The `filePath` SHALL use an extension derived from the attachment's `mediaType` using a static map; for unlisted media types, `.txt` SHALL be used as the fallback extension.

#### Scenario: Text file upload reaches the model as a selection attachment
- **WHEN** the user uploads a plain-text file (e.g., `README`, `mediaType: "text/plain"`) and sends the message
- **THEN** the Copilot engine maps it to a `selection` attachment with `filePath` ending in `.txt`, `displayName` matching the original label, and `text` containing the decoded file content

#### Scenario: JSON file upload gets correct extension
- **WHEN** the user uploads a file with `mediaType: "application/json"` and a label without an extension
- **THEN** the mapped `selection` attachment has `filePath` ending in `.json`

#### Scenario: File with extension in label keeps its extension
- **WHEN** the user uploads a file with a label that already contains an extension (e.g., `"config.yaml"`)
- **THEN** no additional extension is appended to the `filePath`

#### Scenario: Temp file is written to disk before being handed to the SDK
- **WHEN** the engine maps a text attachment to a `selection` attachment
- **THEN** the file at `selection.filePath` exists on disk and contains the decoded text content at the moment `session.send()` is called

### Requirement: CopilotEngine delivers #file chip references as selection attachments
The system SHALL map `Attachment` objects whose `data` field matches the `@file:<path>` pattern to Copilot SDK `selection` attachments by reading the referenced file from the working directory.

#### Scenario: Plain #file ref reaches the model
- **WHEN** the user inserts a `#src/foo.ts` chip and sends the message
- **THEN** the Copilot engine maps it to a `selection` attachment with `displayName` matching the chip label and `text` containing the full file contents

#### Scenario: Line-ranged #file ref delivers only the specified lines
- **WHEN** the user inserts a `#src/foo.ts:L2-L4` chip and sends the message
- **THEN** the Copilot engine maps it to a `selection` attachment whose `text` contains only lines 2 through 4 of the file (1-based, inclusive) and whose `selection` metadata reflects the start and end positions
