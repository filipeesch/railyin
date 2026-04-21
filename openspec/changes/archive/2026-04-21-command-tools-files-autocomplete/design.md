## Context

The chat input in `TaskDetailDrawer.vue` is a plain PrimeVue `<Textarea>`. Slash commands are resolved server-side in `resolveSlashReference()` (and listed from `.github/prompts/` for Copilot or via `session.supportedCommands()` for Claude). File/symbol references and agent/tool references have no discovery mechanism at all — users must know these by memory.

The codebase now has LSP v1 (task-scoped `TaskLSPRegistry`, `workspace/symbol` wired in `LSPServerManager`), MCP tools already listed via `mcp.getStatus`, and Monaco already bundled for file editing. However, Monaco lacks true atomic widget nodes for chip-style references. CodeMirror 6 provides `Decoration.replace()` + `EditorView.atomicRanges()` natively, making it the better fit for this use case.

## Goals / Non-Goals

**Goals:**
- Replace `<Textarea>` with a CodeMirror 6 editor that visually renders inserted references as atomic chips
- Implement `/` autocomplete: discover and list slash commands from the active engine
- Implement `#` autocomplete: unified fuzzy file + LSP symbol picker with progressive symbol loading
- Implement `@` autocomplete: MCP tools listing (sub-agent routing deferred)
- Add `listCommands(taskId)` to `ExecutionEngine` interface, implemented for Claude, Copilot, and Native engines
- Expose `lsp.workspaceSymbol` and `workspace.listFiles` as RPC endpoints for frontend use
- Expand Copilot slash-prompt lookup paths to include personal scope and project root

**Non-Goals:**
- Sub-agent routing via `@` (tracked separately in task #109)
- Changing how the backend resolves slash commands at execution time (server-side `resolveSlashReference` is unchanged except for Copilot path expansion)
- Monaco editor migration for file editing overlays (unrelated)

## Decisions

### Decision: CodeMirror 6 over Monaco for the chat input

Monaco is already bundled and familiar, but it does not support true atomic widget nodes. Implementing chip-on-backspace with Monaco requires custom cursor management (~100 lines of fragile selection/range logic). CodeMirror 6's `Decoration.replace()` + `EditorView.atomicRanges()` achieves the same in ~20 lines and is battle-hardened by VS Code itself. CM6's `@codemirror/autocomplete` extension also provides trigger-character completions out of the box. Added bundle cost: ~80 KB gzip (new dependency).

**Alternatives considered:**
- Keep `<Textarea>` + show a separate popover: no chip rendering, references degrade to plain text
- Monaco with `InjectedTextOptions`: visual-only decorations, cursor still traverses them character-by-character — backspace doesn't delete the whole chip

### Decision: Atomic chip tokens for references

When the user selects a completion (`/command`, `#file`, `@tool`), the editor replaces the trigger + query text with a `Decoration.replace()` widget rendered as a chip. The chip is atomic (single backspace removes it entirely). The underlying document stores a compact marker like `[#src/foo.ts]` so the text sent to the backend can be parsed. Displayed chip: short name + icon. Stored text: full path/identifier.

**Alternatives considered:**
- Plain text insertion (e.g. `#src/foo.ts`): simpler, but no visual distinction; user can accidentally edit the path
- Separate chips above the textarea (current `pendingAttachments` pattern): already used for file/image attachments — usable but less fluid than inline chips

### Decision: Claude uses `session.supportedCommands()` exclusively, no filesystem fallback

The Claude Agent SDK auto-discovers `.claude/commands/**/*.md` including subdirectory namespacing (`subdir/file → subdir:file`). The `system/init` event already carries `slash_commands` in our `claude/events.ts`. We trust the SDK for all discovery — no filesystem glob needed. If no session is active when the user types `/`, we return an empty list (the session will exist in practice since the user is in a task).

### Decision: Copilot `listCommands` globs three ordered paths

```
1. worktreePath/.github/prompts/*.prompt.md         (checked-out working dir)
2. projectRootPath/.github/prompts/*.prompt.md      (only if differs from worktreePath)
3. ~/.github/prompts/*.prompt.md                    (personal/user scope)
```

`worktreePath` and `projectRootPath` are already stored per-task in the DB (`task_git_context` table). Dedup by command name: earlier path wins (more specific > personal). No caching — a fresh glob is issued each time the user types `/`. This is cheap (3 glob calls) and handles newly created commands without invalidation logic.

### Decision: `#` resolves at send time, not at insert time

When the user selects a `#` reference (file or symbol), a chip is shown in the editor but content is NOT fetched immediately. At send time, `taskStore.sendMessage()` parses the document for chip markers, reads file content or symbol code range, and adds them to `pendingAttachments`. This mirrors VS Code Copilot Chat behavior: `#` references become context attachments — file content injected alongside the message, not inline in the prompt text.

File reference → read full file content → inject as text attachment  
Symbol reference → read line range from LSP symbol info → inject as fenced code snippet

**Alternatives considered:**
- Fetch at insert time: content could be stale by send time; also blocks autocomplete UX waiting for reads
- Inline substitution into the prompt text: pollutes the message; doesn't compose with existing attachment display

### Decision: `#` LSP symbols use progressive enhancement

When the user types `#`, file results appear immediately (via `workspace.listFiles` RPC, which runs `git ls-files`). LSP symbol results are fetched in parallel via `lsp.workspaceSymbol`. If the LSP isn't started yet, `TaskLSPRegistry.getManager()` is called to warm it up; the symbol section shows a loading spinner until results arrive. If LSP is unavailable (no servers configured), the file-only picker works standalone with no error state.

### Decision: `@` autocomplete lists MCP tools only in this change

`mcp.getStatus` already returns the full list of tools per server. We expose these in the `@` picker grouped by MCP server. Each selected tool inserts a chip `@server:toolName`. At send time the chip is converted to plain text in the message (the engine already handles MCP tool execution). Sub-agent routing (`@claude`, `@copilot`) is deferred to task #109 and will extend the same `@` picker.

### Decision: New `listCommands` method on `ExecutionEngine` interface

```typescript
listCommands(taskId: string): Promise<CommandInfo[]>
// CommandInfo: { name: string; description?: string; argumentHint?: string }
```

The RPC handler calls the active engine's `listCommands()`. This follows the existing `listModels()` pattern in `types.ts`. The `taskId` allows the engine to look up task context (worktreePath, projectRootPath, active session) from the DB without passing it through the RPC call.

## Risks / Trade-offs

- **CM6 learning curve** → Mitigation: Scope the CM6 component tightly; keep it in a single `ChatEditor.vue` wrapper that exposes the same v-model interface as the existing Textarea
- **LSP warmup latency on `#` trigger** → Mitigation: Show files immediately, symbols appear progressively; spinner only in the symbol section, not the whole picker
- **Stale command list for Claude** → Mitigation: `session.supportedCommands()` is called fresh each time; if no session yet, return empty list silently
- **`#` content could be large** → Mitigation: Cap file injection at 100 KB; truncate with a notice appended to the attachment. Symbol snippets are line-range bounded and will be small
- **Chip marker format in document** → The stored text `[#src/foo.ts]` must be parseable but not confusable with user-typed text. Use a bracketed format that is unlikely to appear naturally; parse only at send time

## Migration Plan

- The CM6 editor is a drop-in replacement for `<Textarea>` in `TaskDetailDrawer.vue`. The `modelValue` / `onUpdate:modelValue` interface is preserved. Existing features (paste to attach, submit on Enter/Shift+Enter, pending attachments chips above input) continue unchanged.
- New RPC endpoints are additive — no existing endpoints change.
- `listCommands` is a new method on `ExecutionEngine`; the `NativeEngine` can return an empty array initially (no native-specific commands).
- Copilot `resolveSlashReference` path expansion is backward-compatible (adds more lookup locations, doesn't remove any).

## Open Questions

- Should `#` symbol search be scoped to the current file's language or workspace-wide? (Current decision: workspace-wide)
- For `@` MCP tools: should the chip send just the tool name or also pre-fill arguments? (Current decision: name only; arguments stay in the message text)
- Task #109 resolution needed before `@` agents can be completed
