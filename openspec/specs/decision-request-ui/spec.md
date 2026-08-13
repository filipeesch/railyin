## Purpose
Defines the UI components for presenting decision requests to users and displaying decision records within the conversation drawers.

## Requirements

### Requirement: DecisionRequest component fills available drawer width
The system SHALL rename `InterviewMe.vue` to `DecisionRequest.vue`. The component root SHALL use `width: 100%` instead of a hardcoded `max-width: 660px` so that the interview form expands to fill the available drawer space and context content does not overflow the question box at narrow widths.

#### Scenario: Component fills full drawer width
- **WHEN** `DecisionRequest` is rendered inside a wide task drawer
- **THEN** the component stretches to the full width of its container without horizontal overflow

#### Scenario: Component adapts to narrow drawer width
- **WHEN** the drawer is resized to a narrow width
- **THEN** the component shrinks without clipping or horizontal scrollbar

### Requirement: DecisionsPanel displays decision records for a conversation
The system SHALL provide a `DecisionsPanel.vue` component that accepts a `conversationId` prop and renders the list of non-deleted decision records for that conversation fetched via the `decisions.list` RPC. Records SHALL be grouped visually by weight (critical / medium / easy) and SHALL display question, answer, weight badge, `[AI-recorded]` tag when applicable, and revision count badge when `revision_count > 0`. The panel SHALL be read-only; no edit or delete controls are exposed to the user.

#### Scenario: Panel lists decisions for a conversation
- **WHEN** `DecisionsPanel` is mounted with a valid `conversationId`
- **THEN** it fetches and renders all non-deleted decision records

#### Scenario: Records grouped by weight
- **WHEN** the conversation has critical, medium, and easy decisions
- **THEN** they are rendered in three sections in descending weight order

#### Scenario: AI-recorded badge shown
- **WHEN** a record has `is_source_ai = true`
- **THEN** an `[AI-recorded]` badge is visible on that record

#### Scenario: Revised count badge shown
- **WHEN** a record has `revision_count > 0`
- **THEN** a revision count indicator is shown on that record

#### Scenario: Empty state shown when no decisions
- **WHEN** the conversation has no non-deleted decision records
- **THEN** the panel shows an empty-state message such as "No decisions recorded yet"

### Requirement: TabSwitcher is extracted as a shared component
The system SHALL extract the tab-bar UI into a reusable `TabSwitcher.vue` component that accepts a `tabs` prop (array of `{ id: string; label: string }`) and a `modelValue` prop for the active tab id. It SHALL emit `update:modelValue` when the user switches tabs. Both `TaskChatView` and `SessionChatView` SHALL use `TabSwitcher` rather than duplicating tab CSS.

#### Scenario: TabSwitcher emits correct tab id on click
- **WHEN** the user clicks a tab that is not currently active
- **THEN** `TabSwitcher` emits `update:modelValue` with the clicked tab's id

#### Scenario: Active tab is highlighted
- **WHEN** `modelValue` matches a tab id
- **THEN** that tab button has the active visual style applied

### Requirement: TaskChatView exposes a Decisions tab
The system SHALL add a `"decisions"` tab to `TaskChatView.vue` alongside the existing `"chat"` and `"info"` tabs using the shared `TabSwitcher` component. When the Decisions tab is active, `DecisionsPanel` SHALL be rendered with the task's `conversationId`.

#### Scenario: Decisions tab is selectable
- **WHEN** the user clicks the Decisions tab in the task drawer toolbar
- **THEN** `activeTab` transitions to `"decisions"` and `DecisionsPanel` is displayed

#### Scenario: Chat tab returns to conversation
- **WHEN** the user switches from Decisions back to Chat
- **THEN** `ConversationPanel` is displayed and `DecisionsPanel` is hidden

### Requirement: SessionChatView exposes Chat and Decisions tabs
The system SHALL add a full tab system to `SessionChatView.vue` using `TabSwitcher`, with tabs `"chat"` and `"decisions"`. When the Decisions tab is active, `DecisionsPanel` SHALL be rendered with the session's `conversationId`.

#### Scenario: Decisions tab available in session view
- **WHEN** the user clicks the Decisions tab in a standalone chat session
- **THEN** `DecisionsPanel` is rendered with the session's conversationId

#### Scenario: Default tab is chat
- **WHEN** `SessionChatView` is first mounted
- **THEN** the active tab is `"chat"` and the conversation panel is visible

### Requirement: DecisionRequest.vue always renders an optional general notes textarea
`DecisionRequest.vue` SHALL render a general notes textarea below all question sections and above the Submit button. The textarea SHALL be visible on every decision form regardless of question count or type. It SHALL be optional — an empty value SHALL NOT block form submission. The label SHALL read "Additional context" with an "(optional)" qualifier. The placeholder SHALL be "Anything else the AI should know when recording these decisions…". When the textarea contains text at submit time, it SHALL be appended to the `text` payload as `\n\n---\n\nGeneral notes: <value>`. The `generalNotes` ref SHALL be reset to `""` when `props.questions` changes.

#### Scenario: Form submits without general notes
- **WHEN** the user leaves the general notes textarea empty and clicks Submit
- **THEN** the emitted `text` does not contain "General notes" and submission proceeds normally

#### Scenario: General notes appended to submission text
- **WHEN** the user types "Consider cost constraints" in the general notes field and clicks Submit
- **THEN** the emitted `text` ends with `\n\n---\n\nGeneral notes: Consider cost constraints`

#### Scenario: General notes reset on question change
- **WHEN** `props.questions` changes (new decision_request received)
- **THEN** `generalNotes` is reset to `""` so the previous text does not carry over

### Requirement: decisions RPC exposes list and revision endpoints
The system SHALL expose two new RPC methods: `decisions.list(conversationId: string)` returning `DecisionRecord[]` and `decisions.getRevisions(decisionId: number)` returning `DecisionRevision[]`. The frontend `rpc.ts` transport SHALL include typed wrappers for both. `DecisionRecord` and `DecisionRevision` interfaces SHALL be defined in `src/shared/rpc-types.ts`.

#### Scenario: decisions.list returns records for conversation
- **WHEN** `decisions.list` is called with a valid conversationId
- **THEN** all non-deleted records for that conversation are returned ordered by weight descending

#### Scenario: decisions.getRevisions returns revision history
- **WHEN** `decisions.getRevisions` is called with a valid decisionId
- **THEN** all revision rows for that decision are returned ordered by revised_at ascending

### Requirement: User messages are rendered with markdown
The system SHALL render all `user` type conversation messages using `renderMd()` and the `.prose` CSS class, the same as `assistant` messages. The `InlineChipText` component SHALL no longer be used for the user bubble in task/session chat.

#### Scenario: Decision answer markdown renders correctly
- **WHEN** a decision answer user message is displayed (containing `**Q [EASY]:**`, `**A:**` patterns)
- **THEN** bold text, inline code, and other markdown is rendered as formatted HTML, not raw asterisks

#### Scenario: Regular user chat messages render markdown
- **WHEN** a user sends a message containing markdown (bold, code blocks, etc.)
- **THEN** it renders as formatted HTML in the green user bubble

### Requirement: DecisionRequest component has a "Record as decisions" checkbox
`DecisionRequest.vue` SHALL render a checkbox labeled "Record as decisions" near the Submit button, checked by default. The checkbox SHALL be independent of question type and always visible. Its state SHALL be included in the submit emit payload as `recordAsDecisions: boolean`.

#### Scenario: Toggle renders on all question types
- **WHEN** a decision request form with exclusive, non_exclusive, or freetext questions is rendered
- **THEN** the "Record as decisions" checkbox is visible

#### Scenario: Toggle defaults to true
- **WHEN** the form first renders
- **THEN** the "Record as decisions" checkbox is checked

#### Scenario: Unchecking toggle allows submission
- **WHEN** the user unchecks "Record as decisions" and all questions are answered
- **THEN** the Submit button is enabled and submission proceeds with `recordAsDecisions: false`

#### Scenario: Toggle state included in submit payload
- **WHEN** the user clicks Submit
- **THEN** the emitted payload includes `recordAsDecisions` matching the checkbox state

### Requirement: "Other" textarea is visible whenever __other__ is selected
`DecisionRequest.vue` SHALL render the "Other" free-text textarea when `__other__` is selected in a `non_exclusive` question's checkbox selection — regardless of which option row has focus. The desc-area visibility condition SHALL be based on selection state (`isSelected(qi, q, '__other__')`) rather than focus state (`focusedOption[qi] === '__other__'`).

#### Scenario: Other textarea shows when __other__ checked without focus
- **WHEN** the user clicks the "Other" checkbox (without separately clicking the "Other" row)
- **THEN** the "Other" textarea is visible and ready for input

#### Scenario: Submitting with __other__ selected and text filled enables submit
- **WHEN** `__other__` is checked and the "Other" textarea contains text
- **THEN** the Submit button is enabled

#### Scenario: Regular option description still shows when no __other__ selected
- **WHEN** `__other__` is not selected and the user has focused a regular option row
- **THEN** that option's description is rendered in the desc-area

### Requirement: DecisionRequest component supports pagination
The `DecisionRequest.vue` component SHALL support paginated rendering of interview questions: one question per page with a footer containing Back, Next (non-last pages), and Submit (last page). The primary action (Next or Submit) SHALL be a single styled button that replaces itself depending on the page. Per-page answer state (single/multi selection, freetext, other, notes) SHALL be preserved when navigating between pages. Per-question `context` SHALL render as a preamble on its page. A question counter (`current / total`) SHALL be shown in the footer when there are multiple questions.

#### Scenario: Component paginates multiple questions
- **WHEN** the component receives more than one question
- **THEN** only the first question page is shown initially
- **AND** the footer shows Next on non-last pages and Submit on the last page
- **AND** Back returns to the previous page with answers preserved

#### Scenario: Single question shows Submit directly
- **WHEN** the component receives exactly one question
- **THEN** the footer shows Submit (no Next)

#### Scenario: Per-question context rendered on its page
- **WHEN** a question carries a `context` string
- **THEN** the context preamble renders above that question's text on its page

#### Scenario: Next is gated by per-page validity
- **WHEN** the current page's question is not yet validly answered
- **THEN** the Next button is disabled
- **AND** once the page is validly answered the Next button is enabled (non-last pages)

#### Scenario: Question counter shows current page / total
- **WHEN** the interview has more than one question
- **THEN** the footer shows a counter like `1 / 2`
- **AND** the counter updates when navigating pages

#### Scenario: Pagination helpers are pure and testable
- **WHEN** the pagination state is driven via the extracted pure helpers in `src/mainview/utils/decisionRequest.ts`
- **THEN** page advancement, per-page validity, and answer-state preservation are unit-testable without a Vue component harness

### Requirement: DecisionInterviewPanel is a fixed panel above the prompt input
The system SHALL provide a `DecisionInterviewPanel.vue` component that renders the live streaming interview in a fixed position above the todo list / changed-files list and above the prompt input, outside the chat message stream, with a small margin so it does not touch the drawer edges. It SHALL be mounted in `TaskChatView.vue` and `SessionChatView.vue` between the conversation body and the changed-files/todo panels. The panel SHALL read live pages from the conversation store's live-interview state and reconcile to the persisted `decision_request_prompt` at turn end. The panel header SHALL be visually distinct from the interview body and include a dismiss control.

#### Scenario: Panel mounted in task chat view
- **WHEN** a task chat tab is active
- **THEN** `DecisionInterviewPanel` is rendered above `ChangedFilesPanel`/`TodoPanel` and above `ConversationInput`

#### Scenario: Panel mounted in session chat view
- **WHEN** a chat session chat tab is active
- **THEN** `DecisionInterviewPanel` is rendered above `ConversationInput`

#### Scenario: Panel absent when no interview is active
- **WHEN** no `decision_request_page` events or persisted `decision_request_prompt` exist for the conversation
- **THEN** the panel is not rendered (no empty box)

#### Scenario: Panel header is visually distinct
- **WHEN** the panel is rendered
- **THEN** it shows a header bar (e.g. "Questions from the agent") visually distinct from the interview form, with a dismiss button

### Requirement: Panel closes after the interview is answered
The `DecisionInterviewPanel` SHALL close (not render) once the interview has been answered. The panel SHALL treat the interview as answered when a user message exists whose id is greater than the latest persisted `decision_request_prompt` id, OR when the conversation has clearly moved past the interview: a persisted `decision_request_prompt` exists while the task/session execution state is neither `waiting_user` nor `running` and no live pages are streaming. This guarantees an answered interview never reappears — including after an early submission that persisted the answer message before the terminal prompt, after reloads, and after dropped websocket pushes.

#### Scenario: Panel closes after submit
- **WHEN** the user answers the interview and submits, and the resulting user message is appended to the conversation
- **THEN** the panel is no longer visible (no empty box remains)

#### Scenario: Panel stays closed after drawer reopen
- **WHEN** the user closes the drawer and reopens it after the interview was answered
- **THEN** the panel does not render the answered interview

#### Scenario: Panel closes for raced/legacy data (answer before prompt)
- **WHEN** a persisted `decision_request_prompt` exists but the conversation has moved past it (execution state no longer waiting on the interview, no live pages streaming)
- **THEN** the panel does not render the interview

### Requirement: Dismiss button closes the panel without answering
The `DecisionInterviewPanel` SHALL provide a dismiss control that closes the panel without submitting answers or sending anything to the model. Dismissal SHALL be scoped to the current interview episode AND SHALL persist across drawer reopen for that episode: the dismissed episode key (latest prompt id or live execution id) SHALL be stored in the conversation store so a remounted panel stays hidden. A NEW interview episode (pages arriving from a different execution, or a new latest prompt id) SHALL clear the dismissal and allow the panel to spawn again.

#### Scenario: Dismiss hides the panel
- **WHEN** the user clicks the panel's dismiss button
- **THEN** the panel is no longer visible
- **AND** no submitDecisions RPC is called

#### Scenario: Dismiss persists across drawer reopen
- **WHEN** the user dismisses the panel, closes the drawer, and reopens it for the same interview episode
- **THEN** the panel remains hidden (dismissal persisted per episode)

#### Scenario: Dismiss resets on a new interview episode
- **WHEN** the user dismisses the panel and a new execution streams new question pages afterward (or a new terminal prompt is persisted)
- **THEN** the panel renders again for the new questions

### Requirement: Live pages stream into the panel from ephemeral events
The conversation store SHALL maintain a live-interview state per conversation, appending a page for each ephemeral `decision_request_page` stream event received while the execution is running. The panel SHALL render these pages live. A page arriving from a NEW execution SHALL start a fresh interview episode (clearing pages from the previous execution). When the terminal `decision_request_prompt` is persisted, the live pages SHALL reconcile to the persisted payload (the panel becomes the final interview).

#### Scenario: Page appended per stream event
- **WHEN** the store receives a `decision_request_page` stream event
- **THEN** a new page is appended to the live interview state
- **AND** the panel renders the new page without a full reload

#### Scenario: New execution starts a fresh episode
- **WHEN** a `decision_request_page` event arrives from a different execution than the current live pages
- **THEN** the prior execution's pages are cleared and the new page starts the episode

#### Scenario: Terminal prompt replaces live state
- **WHEN** the execution ends and a persisted `decision_request_prompt` message arrives
- **THEN** the panel's questions match the persisted payload and Submit becomes active

### Requirement: In-chat interview rendering removed entirely
The `MessageBubble.vue` component SHALL NOT render `decision_request_prompt` messages in the chat stream at all — not the interactive form, not an answered summary, not a hint. The persisted message SHALL remain in the conversation history and continue to feed the fixed `DecisionInterviewPanel` and the decision-context injector, but SHALL render nothing inside `MessageBubble`.

#### Scenario: New interview not rendered inside chat bubble
- **WHEN** a new interview streams and finalizes
- **THEN** the chat message stream shows no balloon for the interview
- **AND** the interactive form lives only in the fixed panel above the prompt input

#### Scenario: Legacy persisted prompts render nothing
- **WHEN** a `decision_request_prompt` message predating this change is loaded
- **THEN** it renders nothing in the chat stream (no balloon, no hint, no answered summary)

### Requirement: Resize handle grows the panel upward
The resize handle on the panel's top edge SHALL increase the panel body height when dragged UP and decrease it when dragged DOWN (the panel's bottom is fixed in the drawer flow; the chat sits above the panel). Double-clicking the handle SHALL reset the body height to the default.

#### Scenario: Drag up enlarges
- **WHEN** the user drags the resize handle upward
- **THEN** the panel body height increases (capped at 70% of the viewport)

#### Scenario: Drag down shrinks
- **WHEN** the user drags the resize handle downward
- **THEN** the panel body height decreases (floored at the minimum height)

#### Scenario: Double-click resets
- **WHEN** the user double-clicks the resize handle after resizing
- **THEN** the panel body height returns to the default

### Requirement: Footer is fixed; only question content scrolls
The interview footer (Back, question counter, Record-as-decisions toggle, and the primary Next/Submit action) SHALL remain visible (fixed) at the bottom of the panel while the vertical overflow scrollbar SHALL be confined to the question content area (context preamble, question, options, notes, general notes).

#### Scenario: Long content scrolls inside the content area
- **WHEN** a question's content is taller than the panel body
- **THEN** only the question content area scrolls
- **AND** the footer remains fully visible without scrolling

#### Scenario: Footer always reachable
- **WHEN** the user scrolls to the bottom of a long interview
- **THEN** the Back/Next/Submit footer is still visible (fixed, not scrolled away)

### Requirement: DecisionRequest validation and formatting logic is extracted to testable utilities
The validation (`canSubmit`), answer formatting (`parts` text and `decisions` array), and selection-state logic from `DecisionRequest.vue` SHALL be extracted into a plain TypeScript module at `src/mainview/utils/decisionRequest.ts`. `DecisionRequest.vue` SHALL import and call these pure functions rather than inlining the logic. The module SHALL export: `canSubmitDecisionRequest(questions, state)`, `buildDecisionAnswerParts(questions, state)`, `buildDecisionAnswers(questions, state)`, `isOptionSelected(question, title, state)`, and `buildSubmissionText(questions, state, generalNotes)`.

#### Scenario: Utility functions are importable without Vue runtime
- **WHEN** a test imports `canSubmitDecisionRequest` from `src/mainview/utils/decisionRequest.ts`
- **THEN** it executes without needing Vue SFC compilation or DOM environment

#### Scenario: Component delegates canSubmit to utility
- **WHEN** `DecisionRequest.vue` computes its `canSubmit`
- **THEN** it calls `canSubmitDecisionRequest` with the current per-question state

#### Scenario: Component delegates answer formatting to utilities
- **WHEN** `DecisionRequest.vue` builds the submit payload in `submit()`
- **THEN** it calls `buildDecisionAnswerParts` and `buildDecisionAnswers` to produce the `text` and `decisions` arrays respectively

### ~~Requirement: DecisionRequest answered-view shows Q/A summary~~ (REMOVED)
**Reason**: The answered-view block is redundant with the user message bubble that immediately follows in the conversation. With user messages now rendering markdown, the user bubble cleanly shows the full Q&A content. The `v-if="answered"` branch has been removed from `DecisionRequest.vue`.
