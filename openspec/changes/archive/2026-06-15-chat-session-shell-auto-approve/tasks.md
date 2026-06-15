## 1. Database Migration

- [x] 1.1 Create `049_chat_session_shell_approval.ts` migration — add `shell_auto_approve INTEGER NOT NULL DEFAULT 0` and `approved_commands TEXT NOT NULL DEFAULT '[]'` columns to `chat_sessions`
- [x] 1.2 Add `shell_auto_approve: number` and `approved_commands: string | null` to `ChatSessionRow` in `src/bun/db/row-types.ts`

## 2. ShellApprovalRepository

- [x] 2.1 Create `src/bun/db/repositories/shell-approval-repository.ts` with `ShellApprovalScope` discriminated union (`{ kind: 'task'; taskId: number } | { kind: 'chat'; conversationId: number }`)
- [x] 2.2 Implement `getState(scope)` — reads from `tasks` for task scope, `chat_sessions WHERE conversation_id = ?` for chat scope
- [x] 2.3 Implement `appendApprovedCommands(scope, binaries)` — writes to `tasks` or `chat_sessions` accordingly
- [x] 2.4 Move `parseShellBinaries` and `getUnapprovedShellBinaries` pure functions into the repository file (or a co-located utility — no DB dependency)
- [x] 2.5 Delete `src/bun/engine/approved-commands.ts` and update all import sites

## 3. Shared Types & Mapper

- [x] 3.1 Add `shellAutoApprove: boolean` and `approvedCommands: string[]` to the `ChatSession` interface in `src/shared/rpc-types.ts`
- [x] 3.2 Update `mapChatSession` in `src/bun/db/mappers.ts` to map the two new columns
- [x] 3.3 Add `"chatSessions.setShellAutoApprove"` RPC method to `RailynAPI` in `src/shared/rpc-types.ts`
- [x] 3.4 Add `"executions.respondShellApproval"` RPC method to `RailynAPI` in `src/shared/rpc-types.ts`
- [x] 3.5 Remove `"tasks.respondShellApproval"` from `RailynAPI` in `src/shared/rpc-types.ts`

## 4. Claude Engine

- [x] 4.1 Add `shellScope: ShellApprovalScope` to `ClaudeRunConfig` in `src/bun/engine/claude/adapter.ts`; change `taskId: number` to `taskId: number | null`
- [x] 4.2 Inject `ShellApprovalRepository` into `DefaultClaudeSdkAdapter` (constructor parameter)
- [x] 4.3 Replace `getApprovedShellState(config.taskId)` with `this.shellApprovalRepo.getState(config.shellScope)` in the `canUseTool` callback
- [x] 4.4 Replace `appendApprovedCommands(config.taskId, unapproved)` with `this.shellApprovalRepo.appendApprovedCommands(config.shellScope, unapproved)` in the `canUseTool` callback
- [x] 4.5 In `src/bun/engine/claude/engine.ts` `execute()`: build `shellScope` from `taskId` / `params.conversationId` and pass it into `ClaudeRunConfig` (remove `taskId ?? 0` coercion)

## 5. OpenCode Engine

- [x] 5.1 Inject `ShellApprovalRepository` into `OpenCodeEngine` (constructor parameter)
- [x] 5.2 Build `shellScope` in `execute()` for OpenCode (same logic as Claude engine)
- [x] 5.3 In the `shell_approval` event branch in `engine.ts`: check `shellApprovalRepo.getState(shellScope).shellAutoApprove` — if true, call `sdkAdapter.respondPermission(executionId, 'always')` and `continue` without yielding

## 6. Stream Processor

- [x] 6.1 In `src/bun/engine/stream/stream-processor.ts`, extend the `shell_approval` case to embed `executionId` in the persisted message JSON: `{ subtype: "shell_approval", command, unapprovedBinaries: [], executionId }`

## 7. Backend Handlers & Orchestrator

- [x] 7.1 In `src/bun/handlers/chat-sessions.ts`: add `chatSessions.setShellAutoApprove` handler — UPDATE `chat_sessions SET shell_auto_approve = ? WHERE id = ?`, return updated `ChatSession`
- [x] 7.2 In `src/bun/handlers/chat-sessions.ts` `chatSessions.create` handler: seed `shell_auto_approve` from `getWorkspaceConfig(workspaceKey).workspace.shell_auto_approve ?? false`
- [x] 7.3 In `src/bun/engine/orchestrator.ts`: add `respondShellApprovalByExecution(executionId, decision)` — query execution row, resolve workspace key and engine, call `engine.resume(executionId, { type: "shell_approval", decision })`, update DB state
- [x] 7.4 Wire new `executions.respondShellApproval` RPC to `orchestrator.respondShellApprovalByExecution` (add to appropriate handler file)
- [x] 7.5 Delete `tasks.respondShellApproval` handler from `src/bun/handlers/tasks.ts`

## 8. Frontend

- [x] 8.1 In `src/mainview/components/MessageBubble.vue`: extend `ShellApprovalPayload` type with `executionId?: number`; update `onShellApprovalRespond` to call `api("executions.respondShellApproval", { executionId, decision })` using the embedded `executionId` — remove the `taskStore.activeTaskId` lookup
- [x] 8.2 In `src/mainview/components/ConversationInput.vue`: change the shell auto-approve toggle guard from `v-if="props.taskId != null"` to `v-if="props.taskId != null || props.sessionId != null"`
- [x] 8.3 In `src/mainview/components/SessionChatView.vue`: pass `:shell-auto-approve="session.shellAutoApprove"` to `ConversationInput` and handle `@update:shell-auto-approve` by calling `api("chatSessions.setShellAutoApprove", { sessionId: session.id, enabled })`
