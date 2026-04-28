## Why

The Playwright test suite for task chat drawer and session chat drawer has significant coverage gaps relative to the OpenSpec requirements. Critical UI behaviors — toolbar action guards, session ordering, attachment history rendering, stream state independence, and legacy message coexistence — are untested, creating a risk that regressions go undetected. The existing spec files also have 3× duplicated helper functions that slow down future test authoring.

## What Changes

- Extract duplicated helper functions (`openTaskDrawer`, `sendMessage`, `openSessionDrawer`, `typeInSessionEditor`, `openSidebar`) from 3 spec files into a shared `e2e/ui/fixtures/helpers.ts` module
- Update existing spec files (`chat.spec.ts`, `extended-chat.spec.ts`, `task-drawer.spec.ts`, `chat-session-drawer.spec.ts`) to import helpers instead of re-declaring them
- Add `task-toolbar.spec.ts`: toolbar action guards — workflow select, terminal/code button visibility guards (worktreePath), retry button (failed state), delete dialog flow
- Add `session-sidebar-edge.spec.ts`: session UX edge cases — auto-generated title format, blur-triggered rename, session re-ordering after WS activity push
- Add `attachment-history.spec.ts`: attachment chips in conversation history, size limit rejection, count limit rejection
- Add `conversation-stream-state.spec.ts`: stream state isolation between concurrent conversations, stream state survives drawer switching
- Add `transition-card-legacy.spec.ts`: coexistence of legacy prompt row (`type: "user", role: "prompt"`) and new `transition_event` card in the same timeline

## Capabilities

### New Capabilities
- `chat-drawer-test-coverage`: Playwright test coverage for task toolbar guards, session edge cases, attachment history, stream isolation, and legacy message coexistence

### Modified Capabilities
- `chat-drawer-tabs`: Adding tests that verify workflow select reflects current column, triggers `tasks.transition` on change, and that terminal/code/retry buttons are conditionally visible per spec
- `chat-session`: Adding tests for auto-title format (`Chat – {Month} {Day}`), blur-triggered rename, and session re-ordering on `lastActivityAt` change
- `chat-attachments`: Adding tests for attachment metadata chips in rendered history, size limit enforcement, and max-count enforcement
- `conversation-state`: Adding tests for stream state isolation across concurrent task conversations and across drawer surface switches

## Impact

- `e2e/ui/fixtures/helpers.ts` — new shared helper module (no production code changes)
- `e2e/ui/fixtures/index.ts` — re-exports helpers
- `e2e/ui/chat.spec.ts`, `e2e/ui/extended-chat.spec.ts`, `e2e/ui/task-drawer.spec.ts`, `e2e/ui/chat-session-drawer.spec.ts` — import from helpers instead of local function declarations
- 5 new Playwright spec files added to `e2e/ui/`
- No backend or production frontend changes
