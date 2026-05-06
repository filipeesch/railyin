## ADDED Requirements

### Requirement: Backend unit tests cover Bug #1 (tool call parentBlockId fix)
The test suite SHALL update S-18 in `stream-tree-scenarios.test.ts` to assert the fixed behavior: after a reasoning block is followed by a tool call with no `parentCallId`, the tool call SHALL have `parentBlockId=null` (sibling root), not `parentBlockId=<reasoning-block-id>`.

#### Scenario: S-18 corrected — tool call is sibling of reasoning block
- **WHEN** a stream emits `reasoning("pre")` → `tool_start("c1")` → `reasoning("in-tool")` → `tool_result("c1")` → `token("Done")`
- **THEN** `c1.parentBlockId` SHALL be `null`
- **THEN** tree roots SHALL be `[pre-r1, c1, t1]`
- **THEN** `pre-r1.children` SHALL be `[]`
- **THEN** `c1.children` SHALL be `[r2]` (in-tool reasoning still nested via callStack)

#### Scenario: S-20 new — bare tool call after reasoning with no parentCallId
- **WHEN** a stream emits `reasoning("pre")` → `tool_start("c1", no parentCallId)` → `tool_result` → `done`
- **THEN** `c1.parentBlockId` SHALL be `null`
- **THEN** tree roots SHALL include both the reasoning block and `c1`

---

### Requirement: Backend unit tests cover Bug #3 (Copilot subagent isInternal fix)
The test suite SHALL add cases to `copilot-events.test.ts` asserting that `tool_start` events with a `parentToolCallId` have `isInternal=false` (unless the tool name matches an internal allowlist).

#### Scenario: CP-A — subagent tool with parentCallId is not suppressed
- **WHEN** a Copilot `tool_start` event has `name='list_files'` and `parentToolCallId='parent-c1'`
- **THEN** the emitted `EngineEvent` SHALL have `isInternal=false`

#### Scenario: CP-B — report_intent stays internal even with parentCallId
- **WHEN** a Copilot `tool_start` event has `name='report_intent'` and `parentToolCallId='parent-c1'`
- **THEN** the emitted `EngineEvent` SHALL have `isInternal=true`

#### Scenario: CP-C — skill-prefixed tool stays internal
- **WHEN** a Copilot `tool_start` event has `name='skill-researcher'` and `parentToolCallId='p1'`
- **THEN** the emitted `EngineEvent` SHALL have `isInternal=true`

#### Scenario: CP-D — internal_-prefixed tool stays internal
- **WHEN** a Copilot `tool_start` event has `name='internal_check'` and no `parentToolCallId`
- **THEN** the emitted `EngineEvent` SHALL have `isInternal=true`

#### Scenario: CP-E — regular tool without parentCallId is not suppressed
- **WHEN** a Copilot `tool_start` event has `name='list_files'` and no `parentToolCallId`
- **THEN** the emitted `EngineEvent` SHALL have `isInternal=false`

---

### Requirement: Backend unit tests cover Bug #4 (Claude array content normalization)
The test suite SHALL add cases to `claude-events.test.ts` asserting that `tool_result` events with array `content` are normalized to a plain string in `detailedResult`.

#### Scenario: CE-A — array of text blocks joined with newline
- **WHEN** a Claude `tool_result` block has `content=[{type:'text',text:'hello'},{type:'text',text:'world'}]`
- **THEN** the emitted `EngineEvent` SHALL have `detailedResult='hello\nworld'`

#### Scenario: CE-B — plain string content passes through unchanged
- **WHEN** a Claude `tool_result` block has `content='plain string'`
- **THEN** the emitted `EngineEvent` SHALL have `detailedResult='plain string'`

#### Scenario: CE-C — mixed blocks: only text blocks included
- **WHEN** a Claude `tool_result` block has `content=[{type:'image',...},{type:'text',text:'hi'}]`
- **THEN** the emitted `EngineEvent` SHALL have `detailedResult='hi'`

#### Scenario: CE-D — empty array yields empty string
- **WHEN** a Claude `tool_result` block has `content=[]`
- **THEN** the emitted `EngineEvent` SHALL have `detailedResult=''`

---

### Requirement: Backend unit tests cover Bug #6 (common tools detailedContent envelope)
The test suite SHALL add cases to `common-tools-registration.test.ts` asserting that `executeCommonTool` results for informational tools (`list_decisions`, `list_tasks`, `create_todo`, etc.) return text parseable as JSON with a `detailedContent` key containing a human-readable string.

#### Scenario: CT-A — list_decisions returns detailedContent
- **WHEN** `executeCommonTool('list_decisions', {}, context)` is called
- **THEN** the result `text` SHALL be valid JSON
- **THEN** `JSON.parse(result.text).detailedContent` SHALL be a non-empty human-readable string

#### Scenario: CT-B — create_todo returns detailedContent confirmation
- **WHEN** `executeCommonTool('create_todo', { title:'Test', description:'Desc', number:10 }, context)` is called
- **THEN** `JSON.parse(result.text).detailedContent` SHALL contain a confirmation string (not raw JSON object notation)

#### Scenario: CT-C — record_decision returns detailedContent
- **WHEN** `executeCommonTool('record_decision', { question:'Q', answer:'A', weight:'easy' }, context)` is called
- **THEN** `JSON.parse(result.text).detailedContent` SHALL be a human-readable string

---

### Requirement: Backend unit tests cover Bug #7 (path stripping in display builders)
The test suite SHALL add cases to `copilot-events.test.ts` asserting that when `translateCopilotStream` is called with `worktreePath` in the options bag, bash tool subjects have the worktree prefix stripped.

#### Scenario: CP-F — bash subject stripped to relative path
- **WHEN** `translateCopilotStream(session, { worktreePath: '/repo/worktree' })` is called
- **AND** the bash tool `command` arg starts with `/repo/worktree/src/index.ts`
- **THEN** the emitted `tool_start` event `display.subject` SHALL equal `src/index.ts` (not the full absolute path)

---

### Requirement: Integration test S-12 covers IPC parentBlockId assertion
The test suite SHALL add S-12 to `stream-pipeline-scenarios.test.ts` verifying that the IPC `tool_start` event emitted mid-stream has `parentBlockId=null` (not the reasoning block id) after Bug #1 is fixed.

#### Scenario: S-12 — IPC tool_start event has parentBlockId=null after reasoning block
- **WHEN** a stream emits `reasoning("pre")` → checkpoint → `tool_start("c1")` using ScriptedEngine
- **AND** the test awaits the checkpoint and inspects the IPC event
- **THEN** the IPC `tool_start` event SHALL have `parentBlockId=null`

---

### Requirement: Playwright E2E covers Bug #2 (ReasoningBubble manual control + label)
The test suite SHALL add cases to `stream-reactivity.spec.ts` asserting that the ReasoningBubble starts collapsed, shows "Reasoning…" during streaming, and "Reasoned" when done.

#### Scenario: A-X1 — reasoning bubble starts collapsed on first chunk
- **WHEN** a WS mock emits the first `reasoning` stream event
- **THEN** the reasoning bubble content area SHALL NOT be visible (collapsed state)

#### Scenario: A-X2 — label shows "Reasoning…" while streaming
- **WHEN** a `reasoning` stream event is active (done=false)
- **THEN** the bubble header text SHALL be "Reasoning…"

#### Scenario: A-X3 — label changes to "Reasoned" when done
- **WHEN** a reasoning block receives `done=true`
- **THEN** the bubble header text SHALL be "Reasoned"

#### Scenario: A-X4 — tool call after reasoning renders as sibling
- **WHEN** a stream emits a reasoning block followed by a tool_call block with no parentBlockId
- **THEN** the tool call row SHALL NOT be a DOM child of the reasoning bubble container

---

### Requirement: Playwright E2E covers Bug #8 (no horizontal scrollbar)
The test suite SHALL add a case to `conversation-body.spec.ts` asserting that `.conv-body` does not produce a horizontal scrollbar when wide content is present.

#### Scenario: CB-3 — no horizontal overflow when ReadView renders wide content
- **WHEN** a message with a wide code block or ReadView is rendered in the conversation body
- **THEN** `document.documentElement.scrollWidth` SHALL equal `document.documentElement.clientWidth`

---

### Requirement: Playwright E2E covers Bug #3 (Copilot subagent tool visibility in stream)
The test suite SHALL add a case to `tool-rendering.spec.ts` asserting that a tool_start event with a parentBlockId renders nested under the parent tool call.

#### Scenario: S-28 — subagent tool call visible under spawning tool
- **WHEN** the WS mock emits `tool_start(parentBlockId='parent-c1')` and the parent block exists
- **THEN** a child tool call row SHALL be visible inside the parent tool call's expanded children area

---

### Requirement: Playwright E2E covers Bug #6 (common tools human-readable output)
The test suite SHALL add a case to `tool-rendering.spec.ts` asserting that a tool result with `detailedContent` displays the human-readable text, not a raw JSON blob.

#### Scenario: S-29 — list_decisions shows human text, not raw JSON
- **WHEN** the WS mock delivers a tool result with `detailedContent='3 decisions found: ...'`
- **THEN** the tool result area SHALL display the detailedContent string
- **THEN** the tool result area SHALL NOT contain raw JSON notation (`{`, `"type":`)

---

### Requirement: Playwright E2E covers Bug #7 (bash subject shows relative path)
The test suite SHALL add a case to `tool-rendering.spec.ts` asserting that a bash tool call subject does not display an absolute path starting with the worktree root.

#### Scenario: S-30 — bash subject is relative, not absolute
- **WHEN** the WS mock delivers a tool_start for `bash` with `display.subject='./src/index.ts'`
- **THEN** the tool call subject text SHALL NOT contain `/Users/` or any absolute path prefix

---

### Requirement: Playwright E2E covers Bug #9 (decision answer markdown rendering)
The test suite SHALL add cases to `interview-me.spec.ts` asserting that user messages after decision submission render as formatted markdown and that the answered dark block is absent.

#### Scenario: T-L — decision answer renders markdown in user bubble
- **WHEN** the user submits a decision form answer containing `**bold**` text
- **THEN** the user message bubble SHALL contain a `<strong>` element
- **THEN** the user message bubble SHALL NOT contain raw `**` asterisks as text

#### Scenario: T-M — no answered dark block after submission
- **WHEN** the user submits a decision form answer
- **THEN** the `.decision-answered-view` element SHALL NOT be present in the DOM
