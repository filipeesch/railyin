## Purpose

Defines the streaming single-question `decision_request` interview flow: per-execution question buffering, the `page` tool-result variant, ephemeral `decision_request_page` engine/stream events, turn-end flush to the terminal `decision_request`, and the fixed paginated `DecisionInterviewPanel` UI above the prompt input.

## Requirements

### Requirement: decision_request accepts one question per call
The `decision_request` tool SHALL accept a single question object per call (`{ context?, question: {...} }`) instead of an array of questions. Each call SHALL validate the single question strictly against the schema; a question missing a required field (e.g. `type`) SHALL return an instructive validation error listing valid enum values, and SHALL NOT append to the buffer or emit a page.

#### Scenario: Valid single question appends and streams a page
- **WHEN** a model calls `decision_request` with a valid single question (including `question` and `type`)
- **THEN** the question is appended to the per-execution decision buffer
- **AND** the tool returns `{ type: "page", text, payload }`
- **AND** the engine emits an ephemeral `decision_request_page` event with the question payload
- **AND** the agent loop continues (no suspend)

#### Scenario: Question missing type returns schema-aware error, buffer preserved
- **WHEN** a model calls `decision_request` with a single question missing the `type` field
- **THEN** the tool returns a result error containing `field 'question.type' is required` and the valid values `"exclusive"`, `"non_exclusive"`, `"freetext"`
- **AND** no page event is emitted
- **AND** previously buffered questions remain intact

#### Scenario: exclusive/non_exclusive question with fewer than 2 options rejected
- **WHEN** a model calls `decision_request` with a question of `type: "exclusive"` or `"non_exclusive"` whose `options` array has fewer than 2 entries
- **THEN** the tool returns an error result naming the offending field and minimum count
- **AND** no page event is emitted and the buffer is preserved

#### Scenario: freetext question without options accepted
- **WHEN** a model calls `decision_request` with a `freetext` question and no `options`
- **THEN** the question is appended, a page event is emitted, and the loop continues

### Requirement: Tool result text guides the model through the streaming contract
Each successful `decision_request` append SHALL return a result text telling the model how many questions are buffered and that it must END ITS TURN to present the interview, so models do not append indefinitely or forget to finalize.

#### Scenario: Append result echoes count and end-turn hint
- **WHEN** a model successfully appends a question
- **THEN** the returned text includes the buffered count (e.g. `Question 2 of 2 buffered`)
- **AND** instructs the model to call `decision_request` again to add more or END ITS TURN to present

### Requirement: Per-execution decision buffer
The system SHALL maintain a per-execution `DecisionQuestionBuffer` on `CommonToolContext.runtime` that accumulates buffered questions across `decision_request` calls within one execution. Each engine SHALL create a fresh buffer per execution and assign it to the context before the run starts.

#### Scenario: Buffer accumulates across multiple calls
- **WHEN** a model calls `decision_request` three times with one question each
- **THEN** the buffer contains three questions in call order
- **AND** each call's returned count reflects the running total

#### Scenario: Buffer is fresh per execution
- **WHEN** a new execution starts for a conversation
- **THEN** the decision buffer is empty (previous execution's buffer is not reused)

#### Scenario: Buffer preserved across a rejected question (keep-on-error)
- **WHEN** a model appends a valid question (Q1), then appends an invalid question (Q2 missing `type`), then appends a corrected Q2'
- **THEN** the invalid Q2 call returns an error and no page event is emitted
- **AND** the buffer still contains Q1 (not cleared)
- **AND** after Q2' the buffer contains Q1 and Q2' in call order
- **AND** the terminal interview presents Q1 and Q2' only

### Requirement: Turn-end flush presents the interview
When an engine run would emit `done`, the system SHALL check the per-execution decision buffer. If it is non-empty, the engine SHALL emit the terminal `decision_request` event with the full accumulated payload (instead of `done`), causing the stream processor to persist a `decision_request_prompt` message and transition the task to `waiting_user`. If empty, the engine SHALL emit `done` normally. Buffered questions SHALL never be silently lost at turn end.

#### Scenario: Model ends turn with buffered questions → interview presented
- **WHEN** the model ends its turn after appending one or more questions
- **THEN** the engine emits `{ type: "decision_request", payload }` with all buffered questions instead of `done`
- **AND** the stream processor persists a `decision_request_prompt` message
- **AND** the task transitions to `waiting_user`

#### Scenario: Model ends turn with empty buffer → normal done
- **WHEN** the model ends its turn without appending any question
- **THEN** the engine emits `done` normally and no interview is presented

### Requirement: decision_request_page is an ephemeral stream event
The system SHALL expose `decision_request_page` as a non-persisted stream event type (`StreamEventType`) emitted once per appended question while the execution is still running. The frontend SHALL use it to append question pages to the live interview panel. It SHALL NOT be persisted as a conversation message and SHALL NOT change execution state.

#### Scenario: Page event streamed while running
- **WHEN** a `decision_request` tool call appends a question
- **THEN** an ephemeral `decision_request_page` stream event reaches the frontend
- **AND** the conversation store appends the page to the live interview state
- **AND** no `decision_request_prompt` message is persisted at that point

#### Scenario: Page events appear on IPC but not in the persisted DB stream
- **WHEN** an execution streams three `decision_request_page` events and then the terminal `decision_request`
- **THEN** the IPC channel contains all three page events plus the terminal event
- **AND** the DB `stream_events` table contains only the terminal `decision_request` (pages are ephemeral, not persisted)

### Requirement: DecisionInterviewPanel is a fixed panel above the prompt input
The system SHALL render the streaming interview in a fixed `DecisionInterviewPanel` component positioned above the todo list / changed-files list and above the prompt input (outside the chat message stream) in both `TaskChatView` and `SessionChatView`. The panel SHALL display one question per page with a footer containing Back and Next/Submit navigation.

#### Scenario: Panel positioned above prompt input outside chat
- **WHEN** a task or chat-session chat tab is active and an interview is streaming
- **THEN** the interview panel appears between the conversation body and the changed-files/todo panels (above the prompt input)
- **AND** the chat message stream does not contain the live interview form

#### Scenario: Pages append live while model is running
- **WHEN** `decision_request_page` events arrive while the execution is still running
- **THEN** the panel appends a new page per event
- **AND** the user can fill answers on any page before the turn ends
- **AND** the footer shows Submit on the current last page, switching to Next when a new page arrives

### Requirement: Submit is active only at waiting_user
The interview panel SHALL allow the user to fill answers at any time, but the Submit button SHALL be disabled until the terminal `decision_request_prompt` is persisted (turn end → `waiting_user`). Submitting SHALL use the existing `submitDecisions` RPC path (task and chat-session variants) with the answers accumulated across pages.

#### Scenario: Submit disabled while streaming
- **WHEN** the execution is still running and pages are streaming
- **THEN** the Submit button is disabled (user can still fill answers and navigate pages)

#### Scenario: Submit enabled after turn end
- **WHEN** the terminal `decision_request_prompt` is persisted and the task/session is `waiting_user`
- **THEN** the Submit button is enabled on the last page
- **AND** submitting routes through the existing `tasks.submitDecisions` / `chatSessions.submitDecisions` RPC

### Requirement: Per-question context rendering
Each question page SHALL render its own optional `context` markdown preamble focused on that question. The legacy top-level `DecisionRequestPayload.context` SHALL remain supported for backward-compatible rendering of persisted messages but is not the primary path.

#### Scenario: Page renders per-question context
- **WHEN** a buffered question carries a `context` string
- **THEN** the page renders the context preamble above the question text

### Requirement: Paginated navigation with Back/Next/Submit
The interview panel footer SHALL provide Back and Next/Submit controls: Back navigates to the previous page, Next (non-last pages) advances to the next page, and Submit (last page) submits the interview. Navigation between pages SHALL preserve per-page answer state.

#### Scenario: Back and Next preserve answers
- **WHEN** the user answers page 1, advances to page 2, and returns to page 1 via Back
- **THEN** page 1's previously entered answers are preserved

#### Scenario: Page append without full reload
- **WHEN** a new `decision_request_page` event arrives while the panel is already rendering earlier pages
- **THEN** the panel appends the new page to the existing live interview without a full conversation reload
- **AND** the user's in-progress answers on earlier pages are not disturbed

#### Scenario: Background task pages do not disturb the active conversation
- **WHEN** `decision_request_page` events arrive for a task that is NOT the active conversation
- **THEN** the active conversation's live interview and stream state are unchanged
- **AND** the background task is marked unread (matching existing background-message behavior)

### Requirement: Engine mock adapters mirror the page contract
Test mock adapters (MockCursorSdkAdapter, MockCopilotSession, MockOpenCodeSdkAdapter, Claude test harness) SHALL inspect tool results in their `callTool` steps: a `{ type: "page" }` result SHALL yield a `decision_request_page` engine event and continue the loop (tool_start/tool_result pair emitted, no abort); a `{ type: "suspend" }` result SHALL retain today's abort semantics. This makes integration scenarios faithful to production. (Decision D11.)

#### Scenario: callTool with page result emits page event and continues
- **WHEN** a mock adapter's `callTool` step invokes a tool that returns `{ type: "page", text, payload }`
- **THEN** the mock yields a `decision_request_page` engine event with the payload
- **AND** emits the tool_start/tool_result pair with the returned text
- **AND** the run continues (no abort signal)

#### Scenario: callTool with suspend result retains abort semantics
- **WHEN** a mock adapter's `callTool` step invokes a tool that returns `{ type: "suspend", text, payload }`
- **THEN** the mock keeps the existing abort behavior (no tool_start/tool_result pair; the run's abort path stops the stream)
