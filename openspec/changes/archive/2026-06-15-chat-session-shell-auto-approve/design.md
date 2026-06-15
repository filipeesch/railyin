## Context

Shell command approval exists today for task executions only. The approval gate lives in `src/bun/engine/claude/adapter.ts` via `getApprovedShellState(taskId)` which queries the `tasks` table. Chat sessions pass `taskId = null` (coerced to `0`), so the query finds no row, always returns `shellAutoApprove: false`, and the engine always emits a `shell_approval` prompt. Worse, `MessageBubble.onShellApprovalRespond` calls `tasks.respondShellApproval` which reads `taskStore.activeTaskId` — null for chat sessions — and returns early without sending the decision back to the engine. The session is stuck.

The OpenCode engine has a parallel issue: it does not consult any auto-approve state at all; it always pauses on `shell_approval` events regardless of context.

The `approved-commands.ts` module is a collection of standalone functions that directly call `getDb()` and read/write only the `tasks` table. It cannot serve chat sessions without surgery.

## Goals / Non-Goals

**Goals:**
- Chat sessions respect workspace `shell_auto_approve` default at creation time
- Chat sessions support a per-session toggle (`shellAutoApprove`) identical in behaviour to the task toggle
- Per-session `approvedCommands` list works for chat sessions (approve_all is persistent)
- Claude and OpenCode engines bypass the approval gate when `shellAutoApprove` is true for a chat session
- The shell approval response flow (`respondShellApproval`) works for chat sessions — the engine resumes correctly
- The UI toggle appears in the chat session drawer, matching the task chat appearance
- A single unified `executions.respondShellApproval` RPC endpoint replaces `tasks.respondShellApproval`

**Non-Goals:**
- Copilot engine changes (it uses `approveAll` natively)
- Pi engine changes (no shell approval at all)
- Migrating the `approved_commands` storage format or approval UX
- Cross-session shared approval lists

## Decisions

### D1: DB columns on `chat_sessions` (not in-memory or workspace-only)
Per-session state (`shell_auto_approve`, `approved_commands`) is stored on `chat_sessions` via a new migration. This mirrors the `tasks` table exactly. Alternatives considered: workspace-only setting (no per-session override), in-memory state (not persistent). The DB column approach survives restarts, enables accurate UI state, and is already the established pattern.

### D2: `ShellApprovalRepository` class under `src/bun/db/repositories/`
The existing flat functions in `approved-commands.ts` are replaced by a `ShellApprovalRepository` injected with `db: Database`. This follows the pattern already established by `DecisionRepository`, `NoteRepository`, etc. The repository accepts a `ShellApprovalScope` discriminated union:

```typescript
type ShellApprovalScope =
  | { kind: 'task'; taskId: number }
  | { kind: 'chat'; conversationId: number };
```

Task scope reads/writes `tasks`. Chat scope reads/writes `chat_sessions WHERE conversation_id = ?`. The pure parsing logic (`parseShellBinaries`, `getUnapprovedShellBinaries`) moves with it or stays as module-level pure functions — no DB dependency.

### D3: `ClaudeRunConfig` carries `shellScope` instead of bare `taskId`
`ClaudeRunConfig.taskId` changes from `number` to `number | null`. A `shellScope: ShellApprovalScope` field is added. The Claude engine builds this in `execute()` before constructing the run config, removing the `taskId ?? 0` coercion that was masking the bug. The `DefaultClaudeSdkAdapter` receives an injected `ShellApprovalRepository`.

### D4: OpenCode engine checks auto-approve before blocking on `shell_approval`
The OpenCode engine's event loop already re-yields `shell_approval` and pauses. We add a pre-check using the same `ShellApprovalRepository` — if `shellAutoApprove` is true, call `sdkAdapter.respondPermission(executionId, 'always')` and `continue` without yielding the event. The `ShellApprovalRepository` is injected into `OpenCodeEngine`.

### D5: `executionId` embedded in `shell_approval` message payload
The stream processor currently serialises `{ subtype: "shell_approval", command, unapprovedBinaries: [] }`. We add `executionId` to this JSON. The frontend `MessageBubble` extracts it and passes it to `executions.respondShellApproval`. This avoids any store lookups and works identically for tasks and chat sessions.

### D6: Unified `executions.respondShellApproval` replaces `tasks.respondShellApproval`
The new RPC endpoint accepts `{ executionId, decision }`. The handler queries `executions WHERE id = ?` to find `task_id` and `conversation_id`, resolves the engine and workspace key, and calls `engine.resume(executionId, ...)`. The old `tasks.respondShellApproval` is deleted entirely (no back-compat wrapper needed — it is purely an internal RPC consumed by a single frontend component).

## Risks / Trade-offs

- **`ClaudeRunConfig.taskId` type change** → Any call site passing `taskId ?? 0` must be audited. The engine itself coerces it; tests using the adapter directly may need updates. Migration: grep for `ClaudeRunConfig` instantiation sites.
- **`approved-commands.ts` deletion** → Any test importing from this path breaks. Migration: update test imports to the new repository class.
- **`tasks.respondShellApproval` removal** → Any automation or test that calls this RPC will break. It is only called from `MessageBubble`, so the blast radius is small, but E2E tests referencing the old endpoint must be updated.
- **OpenCode auto-approve uses `respondPermission('always')`** → OpenCode's `always` maps to "approve all future occurrences at the SDK level". This is a slightly stronger semantic than our `approve_all` (which only persists binaries). Acceptable for now; documented as a known difference.

## Migration Plan

1. Deploy new migration — additive columns, zero downtime
2. Existing chat sessions get `shell_auto_approve = 0` (DEFAULT 0) — no behaviour change for existing sessions
3. Remove `tasks.respondShellApproval` RPC and handler in same deploy as frontend change — both sides ship together
4. No rollback complexity: if rolled back, old frontend calls the old endpoint which still exists in the rollback rev

## Open Questions

- None — all decisions confirmed via design review session.
