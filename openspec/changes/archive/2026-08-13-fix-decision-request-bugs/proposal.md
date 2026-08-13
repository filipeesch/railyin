## Why

The streaming decision-request revamp (PR #138) introduced three regressions and left one UX gap:

1. **Resize handle is inverted** — dragging the top-edge grip *down* grows the panel. Users expect drag-down to shrink the panel (and drag-up to grow it into the chat area above).
2. **Answered interviews reappear** — the D9 design ("Submit active only at `waiting_user`") was never wired up, so the user can submit while the model is still streaming. The answer message is then persisted *before* the terminal `decision_request_prompt`, and the panel's "answered" detection (user message *after* the latest prompt) never matches — the answered interview keeps showing every time the drawer reopens. A superseded execution's turn-end flush can also flip the task back to `waiting_user` and persist a stray prompt after the answer.
3. **In-chat balloon** — `MessageBubble.vue` renders every persisted `decision_request_prompt` as an assistant-style balloon ("Interview answered" plus the user's own Q/A, or "waiting for your input above the message box"), duplicating the panel and the user's own message bubble.
4. **Footer scrolls away** — Back/Next/Submit scroll out of view when the interview content is taller than the panel; the footer should stay fixed with the scrollbar confined to the question content.

## What Changes

- **FIX**: Resize direction in `DecisionInterviewPanel.vue` — drag **up** grows the panel, drag **down** shrinks it; double-click resets. Playwright T-D5 updated to match.
- **FIX**: Submit gated on `waiting_user` — `DecisionInterviewPanel` receives the task/session execution state and passes `readyToSubmit` to `DecisionRequest`, so Submit stays disabled until the terminal prompt is persisted (implements the originally designed D9 and closes the early-submit ordering race).
- **FIX**: Robust answered/stale detection — the panel hides when a user message exists after the latest prompt (id-based) **or** when the conversation has clearly moved past a persisted interview (execution no longer `waiting_user`/`running` and no live pages streaming), so raced/legacy data can never resurface an answered interview.
- **FIX**: Dismissal persists per interview episode across drawer reopen (conversation-store-backed), reset only by a genuinely new episode.
- **FIX**: In-chat balloon removed — `MessageBubble.vue` no longer renders `decision_request_prompt` at all; the persisted message stays in the DB (feeding the panel and decision-context injector) but renders nothing in the chat stream.
- **FIX**: Backend superseded-flush guard — the stream processor discards a terminal `decision_request` flush (no persist, no `waiting_user` flip) when its execution is no longer current (`tasks.current_execution_id` mismatch for tasks; a newer execution exists for chat sessions).
- **FEAT**: Fixed footer — Back / counter / Record-as-decisions toggle / Next|Submit always visible; the vertical overflow scrollbar is confined to the question content inside `DecisionRequest.vue`.
- **CLEANUP**: Store hygiene — live interview state cleared on conversation close; `decision_request_prompt` exempted from the frontend "stream not done" drop guard so the live→persisted reconcile always runs. Panel state derivation extracted to pure, testable helpers in `utils/decisionInterview.ts`.

## Capabilities

### Modified Capabilities

- `decision-request-ui`: resize direction, robust answered detection, per-episode dismissal persistence, fixed footer with content-only scrolling, complete removal of in-chat `decision_request_prompt` rendering.
- `decision-interview-streaming`: actual enforcement of the `waiting_user` submit gate; superseded turn-end flush discarded server-side; terminal prompt never dropped by the frontend append guard.

## Impact

- **Files changed**: `src/mainview/components/DecisionInterviewPanel.vue`, `DecisionRequest.vue`, `MessageBubble.vue`, `TaskChatView.vue`, `SessionChatView.vue`, `src/mainview/stores/conversation.ts`, `src/mainview/utils/decisionInterview.ts` (new), `src/bun/engine/stream/stream-processor.ts`, `e2e/ui/interview-me.spec.ts`.
- **No API/schema change** — RPC methods and `DecisionRequestPayload`/`DecisionRequestQuestion` shapes unchanged.
- **No DB migration** — message types and tables unchanged.
- **No dependencies**.
- **Behavior change**: `decision_request_prompt` messages no longer render in the chat stream; Submit requires `waiting_user`; dismissal sticks per episode; resize direction flips.
- **Soft `submitDecisions` policy**: `tasks.submitDecisions` / `chatSessions.submitDecisions` remain callable at any time (no hard rejection). The frontend gate prevents UI early-submits; if a client still submits while not `waiting_user`, a new execution processes the answers as a fresh turn and the D7 guard discards the superseded flush (no stray prompt, no `waiting_user` flip). (User decision.)
- **Testing (aligned scenarios)**: coverage spans all four layers —
  - **L1 pure helpers**: `utils/decisionInterview.test.ts` (`latestPromptId`, `hasUserMessageAfterPrompt`, `isInterviewStale` truth table, `episodeKey`, `isDismissedEpisode`), `computeResizeHeight` (drag-up grows / drag-down shrinks / clamps), `canSubmitInterview` (gate disabled even when fully answered).
  - **L3 store**: `conversation.test.ts` DR-7 (terminal prompt accepted mid-stream — drop-guard exemption), DR-8 (`setActiveConversation(null)` clears live state), DR-9 (`dismissedInterviews` accessors).
  - **L3 backend**: `stream-processor.test.ts` SP-DR-1..4 (terminal flush happy path, task-superseded, session-superseded, session-current); `shared-rpc-scenarios.ts` `runDecisionRequestEarlySubmitScenario` (ScriptedEngine checkpoint: freeze old turn → `submitDecisions` → proceed → assert no prompt after the answer and no `waiting_user` flip).
  - **L4 Playwright**: T-D5 rewritten (drag up grows / drag down shrinks / double-click resets), T-D6 scroll container + fixed-footer assertion, pending-interview specs seeded `waiting_user`, NEW T-R (stale hides panel), T-S (dismissal persists across reopen), T-T (raced data hides panel), T-U (no chat balloon), T-V (session gating); T-K addition (prompt push while stream active).
  - **Fixture implication**: the default Playwright task is `idle`; with the corrected gating + stale rule, pending-interview specs must seed `executionState: "waiting_user"` (via `tasks.list` handler or `task.updated` push).
  - Full matrix in `design.md` (Testing Strategy) and `tasks.md` §10.
