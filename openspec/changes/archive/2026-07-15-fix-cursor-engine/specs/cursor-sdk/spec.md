## ADDED Requirements

### Requirement: Slash command resolution via CursorDialect
The system SHALL resolve slash-command references in Cursor engine prompts via `CursorDialect.resolvePrompt()` before dispatching to the SDK. Raw slash references SHALL never be sent to the Cursor SDK unresolved.

#### Scenario: on_enter_prompt with slash reference is expanded
- **WHEN** a task transitions to a column whose `on_enter_prompt` is `/gsd-execute-phase`
- **THEN** `CursorEngine` resolves it via `CursorDialect.resolvePrompt()` to the XML-wrapped file body
- **AND** the resolved content is sent to the Cursor SDK as the agent prompt, not the raw `/gsd-execute-phase` string

#### Scenario: Plain prompt is passed through unchanged
- **WHEN** the prompt does not start with a slash reference
- **THEN** `CursorEngine` sends it to the SDK unchanged

### Requirement: Skill content injected into system-instructions prefix
The system SHALL inject the content of `SKILL.md` files from `CursorDialect.getSkillPaths()` into the system-instructions prefix that is prepended to every Cursor agent run, so agents have project skill context on every turn.

#### Scenario: Skills prepended to prompt prefix
- **WHEN** `.cursor/skills/<name>/SKILL.md` files exist in the paths returned by `getSkillPaths()`
- **THEN** each `SKILL.md` content is read and prepended to the `systemBlock` in the Cursor engine's prompt prefix
- **AND** each skill section is preceded by a header identifying the skill directory name

#### Scenario: No skill directories — no change to prefix
- **WHEN** no `.cursor/skills/` directories exist for the task's paths
- **THEN** the prompt prefix is unchanged (no empty section is injected)

### Requirement: Cursor native project rules loaded automatically
The system SHALL pass `settingSources: ["project"]` to the Cursor SDK's local agent options so `.cursorrules` and `.cursor/rules/*.mdc` files are loaded automatically on every run.

#### Scenario: settingSources injected in worker startRun
- **WHEN** the Bun adapter sends a `startRun` message to the worker
- **THEN** the worker includes `settingSources: ["project"]` in the `local` options passed to `Agent.create` / `Agent.resume`
- **AND** the SDK loads `.cursorrules` and `.cursor/rules/*.mdc` from the project working directory

### Requirement: AgentBusyError recovery after decision_request abort
The system SHALL recover transparently from `AgentBusyError` on the subsequent turn after a `decision_request`-triggered run abort, without surfacing an error to the user.

#### Scenario: AgentBusyError on turn following decision_request is retried automatically
- **WHEN** `agent.send(prompt)` throws `AgentBusyError` in the worker
- **THEN** the worker retries immediately with `agent.send(prompt, { local: { force: true } })`
- **AND** the run proceeds normally from that point
- **AND** no error is surfaced to the Bun parent or the user

#### Scenario: Non-AgentBusyError errors are not swallowed
- **WHEN** `agent.send(prompt)` throws an error that is not `AgentBusyError`
- **THEN** the worker propagates the error as a fatal `runDone` status, not as a retry

### Requirement: listCommands resolves paths from DB like other engines
The system SHALL resolve the task's worktree path and project path from the database in `CursorEngine.listCommands()`, identical to the pattern used by `CopilotEngine` and `ClaudeEngine`.

#### Scenario: listCommands returns commands from worktree and project paths
- **WHEN** `CursorEngine.listCommands(taskId)` is called for a task with a known worktree and project
- **THEN** it queries `task_git_context.worktree_path` for the worktree
- **AND** resolves the project path via `getLoadedProjectByKey`
- **AND** delegates to `CursorDialect.listCommands(worktreePath, projectPath)`

### Test scenarios (unit — `cursor/engine.test.ts`)

Mirrors `pi-harness.test.ts` `PiEngine dialect injection` section (SpyDialect pattern):

#### Dialect dependency injection
- Dialect passed to constructor is stored and used for all dialect operations
- Default dialect is `CursorDialect` when none provided
- Pre-aborted execution does NOT call `dialect.resolvePrompt`

#### Slash resolution in `_run()`
- Prompt starting with `/` is resolved via `dialect.resolvePrompt()` before composition; `adapter.trace.runConfigs[0].prompt` contains XML-wrapped body, not raw slash string
- Plain prompt is forwarded unchanged

#### Skill injection in `_run()`
- Skill `SKILL.md` content from `dialect.getSkillPaths()` is prepended to the composed prompt
- Multiple skill directories all injected
- Empty `getSkillPaths()` result leaves prompt prefix unchanged

### Test scenarios (RPC — `cursor/rpc-scenarios.test.ts`)

Mirrors `copilot-rpc-scenarios.test.ts` L218 "stores raw slash prompts while executing the resolved prompt body":

- Create `.cursor/commands/opsx-propose.md` in `runtime.gitDir`; send `[/opsx-propose|/opsx-propose] add-dark-mode`; assert `adapter.trace.runConfigs[0].prompt` contains XML-wrapped body, not raw slash string
- Raw chip syntax is stored verbatim in `conversation_messages` (user message content), resolved body only goes to the SDK

### Test scenarios (worker — `cursor/worker-send-retry.test.ts` + `cursor/worker-options.test.ts`)

Extracted pure functions following `worker-resume.mjs` → `worker-resume.test.ts` pattern:

#### `buildBaseOptions` (worker-options)
- Always includes `settingSources: ["project"]` in `local`
- Forwards `apiKey`, `model`, `cwd`, `customTools`

#### `sendWithBusyRetry` (worker-send-retry)
- First `agent.send()` succeeds → no retry, result returned directly
- First `agent.send()` throws `AgentBusyError` → retries with `{ local: { force: true } }`
- Second attempt (with `force: true`) succeeds → resolves normally
- Non-`AgentBusyError` is NOT swallowed → re-throws immediately
- Only retries once — second `AgentBusyError` still propagates

## MODIFIED Requirements

### Requirement: Per-conversation agent lifecycle
The system SHALL use a caller-defined deterministic Cursor `agentId` per conversation and resume the same agent across turns so SDK-side chat history is preserved without any Railyin-side persistence.

#### Scenario: Deterministic id derivation
- **WHEN** an execution starts on a conversation
- **THEN** the engine computes `agentId` as a UUIDv5 derived from a fixed Railyin namespace and the name `task:${taskId}` when the conversation is task-scoped, or `conversation:${conversationId}` otherwise
- **AND** forwards it to the worker via `StartRunRequest.agentId`
- **AND** the derivation is pure: the same `(taskId, conversationId)` always yields the same UUID, and task-scoped ids are independent of `conversationId`

#### Scenario: First execution on a conversation
- **WHEN** the worker receives `startRun` and `Agent.resume(agentId, ...)` throws (no agent exists yet)
- **THEN** the worker calls `Agent.create({ agentId, apiKey, model, local: { cwd, customTools, settingSources: ["project"] } })` with the same caller-supplied `agentId`
- **AND** sends the prompt via `agent.send(prompt)`
- **AND** the agent's working directory is the task's worktree path
- **AND** if `agent.send(prompt)` throws `AgentBusyError`, the worker retries with `{ local: { force: true } }`

#### Scenario: Subsequent execution resumes the agent
- **WHEN** the worker receives `startRun` with the same `agentId` and an agent already exists in the SDK's local store
- **THEN** `Agent.resume(agentId, { apiKey, model, local: { cwd, customTools, settingSources: ["project"] } })` succeeds and returns the prior agent
- **AND** the worker does NOT call `Agent.create`

#### Scenario: Resume failure of an existing agent falls back to create
- **WHEN** `Agent.resume(agentId, ...)` throws for any reason
- **THEN** the worker falls back to `Agent.create({ ...baseOptions, agentId })` with the same `agentId`
- **AND** the new agent can be resumed on future turns
