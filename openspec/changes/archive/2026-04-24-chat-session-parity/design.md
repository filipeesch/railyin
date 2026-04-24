## Context

Chat sessions and task conversations now share the same drawer shell, but they still diverge in important behavior. Task chat uses the full `ChatEditor`, structured stream-tree rendering, context usage UI, and MCP controls, while session chat still uses a reduced path with a plain textarea, legacy token-only streaming, and no session-scoped context/tool UX.

The product goal is that chat UX is the same across chat experiences and only the surrounding scope changes. Sessions are workspace-scoped rather than task-scoped, so parity needs to preserve the shared surface while swapping task worktree assumptions for workspace-root assumptions.

## Goals / Non-Goals

**Goals:**
- Make session chat use the same core input and rendering surface as task chat
- Scope session autocomplete and execution working directory to the workspace root
- Expose context usage and manual compaction in session chat
- Expose MCP tool controls in session chat
- Ensure session streaming renders structured tool/reasoning/status blocks the same way as task chat

**Non-Goals:**
- Re-architect all conversation state ownership (handled by `conversation-store-unification`)
- Remove legacy database columns or task-keyed schema fields
- Change task-only features such as changed files, Info tab content, or worktree-specific attachments semantics

## Decisions

### 1. Session chat uses the shared ChatEditor

**Decision:** Session chat will render `ChatEditor` instead of a plain `<Textarea>`.

**Rationale:** The editor behavior is part of the shared chat experience: keyboard semantics, resizing, chip rendering, and autocomplete UX should not change depending on whether the conversation belongs to a task or a session.

**Alternative considered:** Keep the textarea in sessions. Rejected because it preserves an obvious parity break and leaves two separate input experiences to maintain.

### 2. Session autocomplete is workspace-scoped

**Decision:** Session-mode autocomplete resolves against the workspace root path from workspace config rather than a task worktree.

**Rationale:** Sessions are intentionally not tied to a task, but they still live in a workspace. Workspace-scoped discovery lets session chat offer file and symbol assistance without inventing a fake task context.

**Alternative considered:** Disable autocomplete in sessions. Rejected because it makes the shared editor feel incomplete and wastes a useful workspace-wide affordance.

### 3. Session context usage is conversation-scoped

**Decision:** Session context usage and manual compaction use conversation-scoped data rather than task-scoped data.

**Rationale:** Context pressure belongs to the conversation itself, not to task metadata. This keeps session behavior correct and also prepares the task path for the same shared primitive.

### 4. MCP tool controls are workspace/session compatible

**Decision:** Session chat exposes the same MCP tools affordance as task chat, but its enabled-tool state is no longer assumed to be stored only on tasks.

**Rationale:** MCP tools are a workspace-level capability. Sessions should be able to opt into the same tool selection UX without fabricating a task ID.

### 5. Session execution cwd uses workspace root

**Decision:** Standalone session executions use `workspace.workspace_path` as the working directory, with the existing config-dir fallback remaining in place for compatibility.

**Rationale:** The workspace root is the correct scope for standalone chat. Keeping the fallback preserves behavior in installs that have not yet populated the workspace path.

## Risks / Trade-offs

- **Workspace autocomplete can surface many more files than a task worktree** → Mitigation: reuse existing filtering and query-driven lookup rather than eagerly loading the tree.
- **Session MCP state may require a new persistence shape** → Mitigation: define the UX contract here and land persistence/wiring alongside implementation, without removing task-scoped behavior yet.
- **Context usage parity depends on shared conversation-scoped APIs** → Mitigation: land the session behavior on top of the conversation-scoped endpoint introduced in `conversation-store-unification`.
- **Workspace root may be missing in some configs** → Mitigation: preserve the current fallback path so older workspaces still function.

## Migration Plan

1. Keep existing DB columns and task-keyed compatibility paths in place.
2. Add conversation/session-compatible backend endpoints or handlers needed for context usage and tool selection.
3. Switch session chat to shared input/rendering features while preserving fallback behavior where config is incomplete.
4. Validate parity through shared Playwright coverage.

Rollback is low risk because the change is primarily frontend and handler wiring; schema cleanup is explicitly out of scope.

## Open Questions

- Should session attachments remain task-only for now, or should workspace-scoped file attachments be promoted to full parity as part of the same effort?
- Should workspace autocomplete include all projects in the workspace equally, or prefer configured project roots first when ranking results?
