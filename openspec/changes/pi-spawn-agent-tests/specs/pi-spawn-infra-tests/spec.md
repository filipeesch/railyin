## ADDED Requirements

### Requirement: buildAllTools adds spawn_agent only when SpawnConfig is present
`buildAllTools` SHALL include `spawn_agent` in the returned tools array if and only if `AllToolsOptions.spawnConfig` is defined.

#### Scenario: BT-1 spawn_agent present when spawnConfig provided
- **WHEN** `buildAllTools({ spawnConfig: validConfig, tools: ["read"] })` is called
- **THEN** the returned tools array includes a tool with name `"spawn_agent"`

#### Scenario: BT-2 spawn_agent absent when spawnConfig is undefined
- **WHEN** `buildAllTools({ spawnConfig: undefined, tools: ["read", "write"] })` is called
- **THEN** the returned tools array does NOT include any tool named `"spawn_agent"`

#### Scenario: BT-3 spawn_agent absent when spawnConfig is null
- **WHEN** `buildAllTools({ tools: ["read"] })` with no `spawnConfig` key
- **THEN** no `spawn_agent` tool in result (structural guard for children)

#### Scenario: BT-4 Other tools unaffected by spawnConfig presence
- **WHEN** `buildAllTools({ spawnConfig: validConfig, tools: ["read", "lsp"] })` is called
- **THEN** `read` and `lsp` group tools are present regardless of spawnConfig

#### Scenario: BT-5 Unknown tool group name is silently ignored
- **WHEN** `buildAllTools({ tools: ["nonexistent_group"] })` is called
- **THEN** no error thrown; result contains no tools from the unknown group

### Requirement: PiEngine.cancel() aborts only the target execution's agent
After the bug fix, `PiEngine.cancel(executionId)` SHALL abort only the agent associated with that executionId, leaving other running agents unaffected.

#### Scenario: CE-1 cancel() with executionId only aborts that execution's agent
- **WHEN** two executions are running with FakeAgent instances A and B, and `cancel(executionIdA)` is called
- **THEN** FakeAgent A receives `abort()`
- **AND** FakeAgent B does NOT receive `abort()`

#### Scenario: CE-2 cancel() with unknown executionId is a no-op
- **WHEN** `cancel(99999)` is called with an ID that has no active agent
- **THEN** no error thrown and no agents aborted

#### Scenario: CE-3 cancel() cleans up the executionId mapping after abort
- **WHEN** `cancel(executionId)` is called
- **THEN** subsequent `cancel(executionId)` calls are no-ops (entry removed from map)

#### Scenario: CE-4 cancel() before agent starts is a no-op
- **WHEN** an execution is registered but `agentFactory` has not yet been called
- **THEN** `cancel(executionId)` does not throw

### Requirement: PiEngine evicts sessions and harnessContexts on task lifecycle events
`PiEngine` SHALL remove entries from its `sessions` and `harnessContexts` maps when a task's execution is archived or the task is deleted. No unbounded growth over time.

#### Scenario: SC-1 Session map entry removed after execution archive
- **WHEN** a completed execution is archived via the orchestrator lifecycle hook
- **THEN** `piEngine.sessions` no longer contains an entry for that conversationId

#### Scenario: SC-2 HarnessContext map entry removed after execution archive
- **WHEN** a completed execution is archived
- **THEN** `piEngine.harnessContexts` no longer contains an entry for that conversationId

#### Scenario: SC-3 Both maps remain populated for active executions
- **WHEN** one execution completes and is archived while another is still running
- **THEN** only the archived execution's entries are removed; the active one remains
