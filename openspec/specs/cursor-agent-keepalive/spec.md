# cursor-agent-keepalive Specification

## Purpose
TBD - created by archiving change cursor-agent-lifecycle-compaction. Update Purpose after archive.
## Requirements
### Requirement: Cursor agent is kept warm across turns via a pooled registry
The system SHALL keep a Cursor conversation's agent alive between turns by holding the live `SDKAgent` in a per-`agentId` pool instead of closing it after each run. The pool SHALL be backed by idle-timeout eviction so agents are eventually closed when idle.

#### Scenario: Agent remains open after a run completes
- **WHEN** a Cursor run for a conversation finishes normally (`done`)
- **THEN** the adapter does NOT call `agent.close()` on that agent
- **AND** the agent is returned to the pool keyed by its `agentId` with its lease set idle

#### Scenario: Next turn resumes the warm agent
- **WHEN** a subsequent run starts for the same conversation (same `agentId`) while the previous agent is still in the pool
- **THEN** the adapter calls `Agent.resume(agentId, ...)` and reuses the live agent rather than creating a fresh one
- **AND** `Agent.create` is not called for that turn

#### Scenario: Agent is recreated when absent from the pool
- **WHEN** a run starts for an `agentId` not present in the pool (first turn, or after eviction/restart)
- **THEN** the adapter falls back to `Agent.resume` then `Agent.create({ ...options, agentId })`, restoring the persisted conversation from the SDK local store (the create path SHALL preserve conversation context)

#### Scenario: Idle agent is evicted and closed after the timeout
- **WHEN** a pooled agent has no activity for longer than the idle timeout (`RAILYN_ENGINE_IDLE_TIMEOUT_MS`, default 10 minutes)
- **THEN** the pool closes that agent and removes it from the pool
- **AND** a later turn for that `agentId` recreates the agent (restoring persisted history)

#### Scenario: Shutdown closes all pooled agents
- **WHEN** `CursorEngine.shutdown()` / `CursorSdkAdapter.shutdownAll()` is invoked (app exit)
- **THEN** every pooled agent is closed and the pool is emptied

#### Scenario: decision_request leaves the agent warm
- **WHEN** a run is cut short by a suspend-loop tool (e.g. `decision_request`)
- **THEN** the agent is returned to the pool (not closed) so the subsequent human turn resumes it with intact context

### Requirement: Agent pool supports concurrent lifecycle via lease touch
The pool SHALL use the shared `LeaseRegistry` to track each agent's idle state, touching the lease on activity and resetting the idle timer on acquire.

#### Scenario: Lease activity resets the idle timer
- **WHEN** an agent is acquired from the pool for a run
- **THEN** its lease is touched, resetting the idle-eviction timer

#### Scenario: Pool is reusable and engine-scoped
- **WHEN** the Cursor adapter constructs its pool
- **THEN** it is registered under the `LeaseRegistry` engine id `"cursor"` and is independent of other engines' pools

