## ADDED Requirements

### Requirement: SpawnTool invokes named agent with system prompt from resolver
When `agent` name is provided, `SpawnTool` SHALL resolve the agent file via `AgentResolver`, construct a `FakeAgent` (in tests) using `agentFactory`, set system prompt from the resolved file, and use the agent file's tool list — ignoring any `tools` array in spawn args.

#### Scenario: ST-1 Named agent uses resolved system prompt
- **WHEN** `spawn_agent({ children: [{ agent: "implementer", instructions: "do X" }] })` is called with FakeAgent wired via `agentFactory`
- **THEN** the FakeAgent is constructed with `systemPrompt` equal to the implementer agent file's body
- **AND** `agent.prompt("do X")` is called (instructions become the first user message)

#### Scenario: ST-2 Named agent tools come from agent file, not spawn args
- **WHEN** spawn args include `tools: ["read"]` but agent file frontmatter says `tools: ["write", "lsp"]`
- **THEN** child is built with `"write"` and `"lsp"` tool groups (agent file wins)

#### Scenario: ST-3 Anonymous child uses tools array from spawn args
- **WHEN** `spawn_agent({ children: [{ instructions: "do Y", tools: ["read", "search"] }] })` (no `agent` key)
- **THEN** child is built with `"read"` and `"search"` tool groups

#### Scenario: ST-4 Instructions override replaces first user message
- **WHEN** `{ agent: "implementer", instructions: "Implement the OrderService" }` is invoked
- **THEN** `agent.prompt("Implement the OrderService")` is called (not the agent file body)

#### Scenario: ST-5 Result is last assistant message text content
- **WHEN** `FakeAgent.state.messages` ends with `{ role: "assistant", content: [{ type: "text", text: "Done." }] }`
- **THEN** the child result entry is `"Done."`

#### Scenario: ST-6 Technical failure sets isError: true on result
- **WHEN** `FakeAgent.state.errorMessage = "model timeout"` after `waitForIdle()` resolves
- **THEN** the spawn tool result has `isError: true` and the error message is included in content

### Requirement: SpawnTool runs multiple children in parallel
`SpawnTool` SHALL start all children via `Promise.all()` (parallel), not sequentially.

#### Scenario: ST-7 Two children run concurrently
- **WHEN** two `FakeAgent` instances are configured with `agentFactory` and both have a 10ms artificial delay
- **THEN** total elapsed time is closer to 10ms than 20ms (parallel execution)

#### Scenario: ST-8 All child results are collected before returning
- **WHEN** `spawn_agent({ children: [child1, child2] })` is invoked
- **THEN** the tool result contains both result strings, one per child, in call order

### Requirement: SpawnTool enforces MAX_CHILDREN cap of 10
When more than 10 children are requested in a single call, `SpawnTool` SHALL return `isError: true` immediately without running any agents.

#### Scenario: ST-9 Eleven children rejected with error
- **WHEN** `spawn_agent({ children: [/* 11 entries */] })` is called
- **THEN** tool returns `{ isError: true, content: "Error: too many children (11 > 10)" }`
- **AND** no `agentFactory` call is made

### Requirement: SpawnTool enforces concurrency cap from SpawnConfig
`SpawnTool` SHALL not run more than `SpawnConfig.maxConcurrency` children simultaneously. Excess children queue and run as slots free.

#### Scenario: ST-10 Concurrency cap limits simultaneous agents
- **WHEN** `maxConcurrency: 2` and 4 children are spawned
- **THEN** at most 2 FakeAgents are in their `waitForIdle()` phase simultaneously

### Requirement: Children cannot spawn sub-agents (recursion guard)
Children are constructed via `buildAllTools` with no `SpawnConfig` in `AllToolsOptions`. Therefore `spawn_agent` is never added to the child's tool set.

#### Scenario: ST-11 Child tool list never contains spawn_agent
- **WHEN** `buildAllTools({ spawnConfig: undefined, tools: ["read", "write"] })` is called
- **THEN** the returned tools array has no tool named `"spawn_agent"`

### Requirement: Child agent events are forwarded to parent stream via onChildEvent
`SpawnTool` SHALL subscribe to each child agent's events, translate them to `EngineEvent`s, tag each with `parentCallId: <spawn tool call ID>`, and call `onChildEvent(callId, event)` from `SpawnConfig`.

#### Scenario: ST-12 Child token event forwarded with parentCallId
- **WHEN** FakeAgent emits `{ type: "message_update", ... text_delta: "Hello" }`
- **THEN** `onChildEvent` is called with `{ type: "token", content: "Hello", parentCallId: "<spawnCallId>" }`

#### Scenario: ST-13 Child tool_start event forwarded with parentCallId
- **WHEN** FakeAgent emits `{ type: "tool_execution_start", ... }`
- **THEN** `onChildEvent` is called with `{ type: "tool_start", parentCallId: "<spawnCallId>", ... }`

#### Scenario: ST-14 Child tool_result event forwarded with parentCallId
- **WHEN** FakeAgent emits `{ type: "tool_execution_end", ... }`
- **THEN** `onChildEvent` is called with `{ type: "tool_result", parentCallId: "<spawnCallId>", ... }`

#### Scenario: ST-15 Concurrent children forward events with distinct parentCallIds
- **WHEN** two children run in parallel with spawn callIds "call-1" and "call-2"
- **THEN** each child's events carry its own callId (no cross-contamination)

### Requirement: SpawnTool cancel propagates abort to all running children
When the parent engine calls `agent.abort()`, `SpawnTool` SHALL call `abort()` on all currently-running child agents.

#### Scenario: ST-16 Abort propagates to child agents
- **WHEN** `agent.abort()` is called on the parent while children are in `waitForIdle()`
- **THEN** all child FakeAgents receive `abort()`

#### Scenario: ST-17 Result after abort returns error for aborted children
- **WHEN** a child's `waitForIdle()` rejects after `abort()`
- **THEN** that child result has `isError: true` with an abort-related message

### Requirement: FakeAgent test double implements Agent duck-type interface
`FakeAgent` SHALL implement `subscribe()`, `prompt()`, `waitForIdle()`, `abort()`, and `state` (with `messages` and `errorMessage`) matching the Pi `Agent` public API.

#### Scenario: ST-18 FakeAgent satisfies Agent type at compile time
- **WHEN** `const _check: AgentLike = new FakeAgent()` is compiled
- **THEN** TypeScript does not emit a type error

#### Scenario: ST-19 FakeAgent delivers scripted events to subscribers
- **WHEN** a subscriber is registered via `fakeAgent.subscribe(cb)` and `prompt()` is called
- **THEN** scripted events are delivered to `cb` in order

#### Scenario: ST-20 FakeAgent resolves waitForIdle after all events emitted
- **WHEN** all scripted events have been delivered
- **THEN** `waitForIdle()` Promise resolves

#### Scenario: ST-21 FakeAgent records abort() call
- **WHEN** `fakeAgent.abort()` is called
- **THEN** `fakeAgent.aborted === true`

#### Scenario: ST-22 Multiple FakeAgents from agentFactory work independently
- **WHEN** `agentFactory` returns a different pre-configured `FakeAgent` on each call
- **THEN** events and results from each instance are independent
