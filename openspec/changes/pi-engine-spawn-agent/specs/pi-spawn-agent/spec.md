## ADDED Requirements

### Requirement: Pi engine provides spawn_agent as a native AgentTool
The Pi engine SHALL include `spawn_agent` in the tool set when `SpawnConfig` is present in `AllToolsOptions`. The tool SHALL be registered as a native `AgentTool.execute()` function — not intercepted at the engine loop level. When `SpawnConfig` is absent (child agents), `spawn_agent` SHALL NOT be added, providing an architectural recursion guard.

#### Scenario: spawn_agent available when spawnConfig provided
- **WHEN** `buildAllTools` is called with a `spawnConfig` in `AllToolsOptions`
- **THEN** the returned tool array includes a tool named `spawn_agent`

#### Scenario: spawn_agent absent when spawnConfig omitted
- **WHEN** `buildAllTools` is called without `spawnConfig`
- **THEN** the returned tool array does NOT include a tool named `spawn_agent`

### Requirement: Children run as fresh Agent instances with instructions-only context
Each child SHALL be a new `Agent` instance with a fresh message history. The child's first user message SHALL be the `instructions` string from the spawn call. The parent's conversation history SHALL NOT be passed to children. When a named agent is used, the agent file body becomes the child's system prompt.

#### Scenario: Child agent has no parent conversation history
- **WHEN** `spawn_agent` executes a child
- **THEN** the child `Agent` is constructed with an empty message history; only the `instructions` string is passed as the initial prompt

#### Scenario: Named agent system prompt applied
- **WHEN** `spawn_agent` executes a child with `agent: "implementer"`
- **THEN** the child `Agent` is constructed with the `implementer` agent file body as `systemPrompt`

#### Scenario: Anonymous child has no system prompt
- **WHEN** `spawn_agent` executes a child with no `agent` field
- **THEN** the child `Agent` is constructed without a `systemPrompt`

### Requirement: Named agents resolved via AgentResolver with 3-level fallback
The system SHALL provide an `AgentResolver` that resolves named agents from: `.railyin/agents/<name>.md` (project) → `~/.railyin/agents/<name>.md` (user-global) → `config/agents/<name>.md` (built-in defaults). If the name cannot be resolved at any level, the spawn call SHALL fail with a clear error message. The agent file body is the system prompt; frontmatter defines `tools` (required) and `model` (optional).

#### Scenario: Project-level agent shadows built-in
- **WHEN** `.railyin/agents/implementer.md` exists and `spawn_agent` invokes `agent: "implementer"`
- **THEN** `AgentResolver` loads the project-level file, ignoring `config/agents/implementer.md`

#### Scenario: User-global agent used when no project override
- **WHEN** `.railyin/agents/implementer.md` does not exist but `~/.railyin/agents/implementer.md` does
- **THEN** `AgentResolver` loads the user-global file

#### Scenario: Built-in fallback when no project or user override
- **WHEN** neither `.railyin/agents/` nor `~/.railyin/agents/` has the named agent
- **THEN** `AgentResolver` loads `config/agents/<name>.md`

#### Scenario: Unknown agent name produces clear error
- **WHEN** `spawn_agent` receives `agent: "unknown-agent"` and no file exists at any resolution level
- **THEN** the child's result entry is an error: `"Agent 'unknown-agent' not found. Create .railyin/agents/unknown-agent.md to define it."`

### Requirement: Agent file controls tools for named agents
When a named agent is used, the tool set SHALL come from the agent file's frontmatter `tools` array. The spawn call SHALL NOT include a `tools` field for named agents. For anonymous children (no `agent` field), the caller SHALL provide a `tools` array.

#### Scenario: Named agent uses file-defined tools
- **WHEN** `spawn_agent` invokes `{ agent: "implementer", instructions: "..." }`
- **THEN** the child's tools are resolved from the `implementer` agent file's frontmatter `tools` array

#### Scenario: Anonymous child uses caller-provided tools
- **WHEN** `spawn_agent` invokes `{ instructions: "...", tools: ["read", "lsp"] }`
- **THEN** the child's tools are resolved from the `tools` array in the spawn args

### Requirement: Child events streamed to parent UI via onChildEvent callback
While children execute, all `EngineEvent`s translated from child `AgentEvent`s SHALL be forwarded to the parent engine's event stream via the `onChildEvent` callback in `SpawnConfig`. Each forwarded event SHALL carry `parentCallId` (the spawn_agent tool call ID) **without** `isInternal: true`. The `isInternal` flag suppresses events entirely in `stream-processor.ts` — child events must persist to DB and reach the UI.

The `EngineEvent` `token` type SHALL be extended with `parentCallId?: string`. `stream-processor.ts` SHALL pass `parentCallId` as `parentBlockId` when emitting `text_chunk` events, causing child tokens to render nested inside the spawn_agent `tool_call` block in the UI.

#### Scenario: Child token events reach parent stream nested under spawn_agent card
- **WHEN** a child agent emits a `message_update` (text delta)
- **THEN** a `{ type: "token", content: "...", parentCallId: "<spawnCallId>" }` event is pushed to the parent's event array
- **AND** `stream-processor.ts` emits a `text_chunk` StreamEvent with `parentBlockId: "<spawnCallId>"`
- **AND** the token appears in the UI nested inside the spawn_agent tool_call block

#### Scenario: Child tool events reach parent stream
- **WHEN** a child agent emits `tool_execution_start` / `tool_execution_end`
- **THEN** corresponding `tool_start` / `tool_result` events tagged with `parentCallId: "<spawnCallId>"` (no `isInternal`) are pushed to the parent's event array

### Requirement: Success is technical completion; parent validates semantics
The spawn tool SHALL report `isError: true` for a child only when a technical failure occurs (agent threw an exception, or `agent.state.errorMessage` is set after idle). Logical correctness of the child's work is NOT validated by the spawn tool — the parent agent is responsible for reading files and verifying output.

#### Scenario: Successful child returns last assistant message text
- **WHEN** a child agent completes without error
- **THEN** the result entry for that child is the text content of the last `AssistantMessage` in `agent.state.messages`

#### Scenario: Technically failed child returns error string
- **WHEN** a child agent throws or `agent.state.errorMessage` is set
- **THEN** the result entry for that child contains the error description and the overall spawn tool result has `isError: true`

### Requirement: Children array hard-capped at MAX_CHILDREN
The spawn tool SHALL reject calls where `children.length > 10` with an error, without executing any children.

#### Scenario: Too many children rejected immediately
- **WHEN** `spawn_agent` is called with 11 or more children
- **THEN** the tool returns `isError: true` with message `"Error: too many children (N > 10)"`

### Requirement: Built-in agents shipped in config/agents/
The system SHALL ship four built-in named agent definitions in `config/agents/`: `implementer` (read/write/lsp/search, fills TODO skeletons), `reviewer` (read/lsp, structured findings), `researcher` (read/search/web, summarizes), `tester` (read/write/shell, runs tests).

#### Scenario: Built-in implementer agent available without project config
- **WHEN** `.railyin/agents/implementer.md` and `~/.railyin/agents/implementer.md` do not exist
- **THEN** `AgentResolver` successfully resolves `"implementer"` from `config/agents/implementer.md`

### Requirement: SpawnConfig injected into PiEngine per execution
`PiEngine.createManagedExecution()` SHALL construct a `SpawnConfig` with the execution's model, `streamFn`, a fresh `AgentResolver`, and an `onChildEvent` closure over the local `events[]` array. This `SpawnConfig` SHALL be passed into `buildAllTools`.

#### Scenario: onChildEvent closure writes to parent events array
- **WHEN** `onChildEvent(spawnCallId, event)` is called during child execution
- **THEN** the event is pushed into the same `events[]` array drained by the parent's AsyncGenerator, tagged with `parentCallId: spawnCallId` (no `isInternal` — that would suppress it)
