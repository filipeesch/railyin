## Why

The chat input in the task drawer is a plain textarea with no discoverability — users must know slash commands, file paths, and tool names by heart. Adding IntelliSense-style autocomplete (triggered by `/`, `#`, and `@`) makes the system dramatically more usable and surfaces capabilities that are currently hidden.

## What Changes

- Replace the plain PrimeVue `<Textarea>` in `TaskDetailDrawer.vue` with a CodeMirror 6 editor component that supports atomic chip decorations and trigger-character completion
- Add `/` autocomplete: lists available slash commands from the active engine (Claude: via `session.supportedCommands()`; Copilot: glob across worktree, project root, and personal scopes)
- Add `#` autocomplete: unified file + LSP symbol picker with fuzzy search; files always available, symbols via progressive LSP enhancement; references resolved to content/snippet at send time
- Add `@` autocomplete: agents and MCP tools picker (placeholder — full routing design deferred to task #109)
- Add `listCommands(taskId)` method to the `ExecutionEngine` interface, implemented per-engine
- Add new RPC endpoints: `engine.listCommands`, `lsp.workspaceSymbol`, `workspace.listFiles`
- Expand Copilot slash-prompt lookup to include personal scope (`~/.github/prompts/`) and project root (when differs from worktree)

## Capabilities

### New Capabilities

- `chat-editor`: CodeMirror 6 editor replacing the plain textarea — supports atomic chip tokens for inserted references, trigger-character autocompletion, and dynamic height
- `slash-command-autocomplete`: `/` trigger that lists available slash commands from the active engine and inserts the selected command slug into the editor
- `file-symbol-autocomplete`: `#` trigger that presents a unified fuzzy-search picker of worktree files and LSP workspace symbols; selected references are resolved to content at send time and injected as context attachments
- `agent-tool-autocomplete`: `@` trigger that lists available agents and MCP tools (scope: MCP tools in this change; sub-agent routing deferred to task #109)

### Modified Capabilities

- `slash-prompt-resolution`: Copilot engine lookup paths expanded from `[worktreePath, process.cwd()]` to `[worktreePath, projectRootPath (if differs), ~/.github/prompts/]`

## Impact

- **Frontend**: `TaskDetailDrawer.vue` — editor replacement; new autocomplete overlay components; `pendingAttachments` extended to carry `#`-reference objects
- **Backend RPC**: `src/shared/rpc-types.ts` — three new endpoints
- **Engine interface**: `src/bun/engine/types.ts` — `listCommands()` added to `ExecutionEngine`
- **Engine implementations**: `CopilotEngine`, `ClaudeEngine`, `NativeEngine` each implement `listCommands()`
- **LSP**: `src/bun/lsp/manager.ts` — `workspaceSymbol()` exposed via RPC for frontend consumption
- **New dependency**: CodeMirror 6 (`@codemirror/view`, `@codemirror/state`, `@codemirror/autocomplete`) ~80 KB gzip
- **No breaking changes** to existing slash command resolution or attachment behaviour
