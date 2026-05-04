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

### Requirement: decisions RPC exposes list and revision endpoints
The system SHALL expose two new RPC methods: `decisions.list(conversationId: string)` returning `DecisionRecord[]` and `decisions.getRevisions(decisionId: number)` returning `DecisionRevision[]`. The frontend `rpc.ts` transport SHALL include typed wrappers for both. `DecisionRecord` and `DecisionRevision` interfaces SHALL be defined in `src/shared/rpc-types.ts`.

#### Scenario: decisions.list returns records for conversation
- **WHEN** `decisions.list` is called with a valid conversationId
- **THEN** all non-deleted records for that conversation are returned ordered by weight descending

#### Scenario: decisions.getRevisions returns revision history
- **WHEN** `decisions.getRevisions` is called with a valid decisionId
- **THEN** all revision rows for that decision are returned ordered by revised_at ascending
