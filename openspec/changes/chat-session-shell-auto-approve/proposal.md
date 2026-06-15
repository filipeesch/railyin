## Why

Chat sessions (non-task conversations) do not respect the workspace-level `shell_auto_approve` setting and have no per-session toggle, causing every shell command to trigger an approval prompt regardless of workspace defaults. Additionally, `MessageBubble.onShellApprovalRespond` silently bails when `taskId` is null, so the approval UI is completely broken for chat sessions.

## What Changes

- Add `shell_auto_approve` and `approved_commands` columns to the `chat_sessions` DB table (new migration)
- Seed `shell_auto_approve` from workspace default at chat session creation
- Introduce a `ShellApprovalRepository` class (replacing flat functions in `approved-commands.ts`) with a discriminated-union scope — either a task or a chat session
- Fix the Claude engine adapter to use the scope-aware repository instead of hardcoded `taskId` lookups
- Fix the OpenCode engine to check auto-approve before pausing on `shell_approval` events
- Add `chatSessions.setShellAutoApprove` RPC endpoint for per-session toggling
- Replace `tasks.respondShellApproval` with a unified `executions.respondShellApproval` endpoint (accepts `executionId`, works for both tasks and chat sessions); **BREAKING**: `tasks.respondShellApproval` is removed
- Embed `executionId` in the persisted `shell_approval` message payload so the frontend can call the unified endpoint
- Add the shell auto-approve toggle to the chat session drawer UI (matching the existing task chat toggle)
- Fix `MessageBubble` shell approval handler to work for chat sessions

## Capabilities

### New Capabilities
- `chat-session-shell-approval`: Shell command approval gate and auto-approve toggle for standalone chat sessions, including per-session persistence of approved commands

### Modified Capabilities
- `shell-command-approval`: Scope extended from tasks-only to cover both tasks and chat sessions; `tasks.respondShellApproval` replaced by `executions.respondShellApproval`
- `chat-session`: Chat session gains `shellAutoApprove` / `approvedCommands` fields and a per-session toggle in the UI

## Impact

- **DB**: New migration `049_chat_session_shell_approval.ts` — two new columns on `chat_sessions`
- **Backend**: `src/bun/db/repositories/shell-approval-repository.ts` (new), `src/bun/engine/approved-commands.ts` (deleted), `src/bun/engine/claude/adapter.ts`, `src/bun/engine/opencode/engine.ts`, `src/bun/engine/stream/stream-processor.ts`, `src/bun/handlers/tasks.ts` (remove old endpoint), `src/bun/handlers/chat-sessions.ts`, new `executions` handler
- **Shared types**: `src/shared/rpc-types.ts` — `ChatSession` type extended; `executions.respondShellApproval` added; `tasks.respondShellApproval` removed
- **Frontend**: `src/mainview/components/MessageBubble.vue`, `src/mainview/components/ConversationInput.vue`, `src/mainview/components/SessionChatView.vue`
- **Engines affected**: Claude, OpenCode (Copilot uses `approveAll` natively; Pi has no shell approval)
