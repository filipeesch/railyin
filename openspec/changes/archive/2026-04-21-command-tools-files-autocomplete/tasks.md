## 1. Dependencies & Setup

- [x] 1.1 Add CodeMirror 6 packages to package.json: `@codemirror/view`, `@codemirror/state`, `@codemirror/autocomplete`, `@codemirror/commands`, `@codemirror/language`
- [x] 1.2 Run `bun install` to lock new dependencies

## 2. Engine Interface: `listCommands`

- [x] 2.1 Add `CommandInfo` type (`{ name: string; description?: string; argumentHint?: string }`) and `listCommands(taskId: string): Promise<CommandInfo[]>` to the `ExecutionEngine` interface in `src/bun/engine/types.ts`
- [x] 2.2 Implement `listCommands` in `ClaudeEngine`: glob `.claude/commands/**/*.md` in worktreePath and `~/.claude/commands/`, colon-separated subdirectory names
- [x] 2.3 Implement `listCommands` in `CopilotEngine`: glob 3 scopes (`worktreePath`, `projectRootPath` if differs, `~/.github/prompts/`), dedup by name (first wins)
- [x] 2.4 Implement `listCommands` in `NativeEngine`: return `[]` (no native-specific commands)

## 3. New RPC Endpoints

- [x] 3.1 Add `engine.listCommands` RPC endpoint in `src/shared/rpc-types.ts` and wire handler in the backend RPC router
- [x] 3.2 Add `workspace.listFiles` RPC endpoint: runs `git ls-files` in `worktreePath`, returns `{ name: string; path: string }[]`
- [x] 3.3 Add `lsp.workspaceSymbol` RPC endpoint: calls `TaskLSPRegistry.getManager()` then `manager.requestWorkspaceSymbol(query)`, returns `SymbolInformation[]`

## 4. Copilot Slash-Prompt Resolution Path Expansion

- [x] 4.1 Update `resolvePrompt()` in `src/bun/engine/dialects/copilot-prompt-resolver.ts`: expand lookup to `[worktreePath, projectRootPath (if differs), ~/.github/prompts/, process.cwd()]`
- [x] 4.2 Update `slash-prompt-resolution` spec to reflect new paths (already done in delta spec — sync to main spec at archive time)

## 5. CodeMirror 6 Chat Editor Component

- [x] 5.1 Create `src/mainview/components/ChatEditor.vue`: CM6 editor with dynamic height, `@send` emit, Enter-to-submit, Shift+Enter newline, paste bubbled to parent
- [x] 5.2 Implement atomic chip decoration system: `Decoration.replace()` + `EditorView.atomicRanges()` for reference chips; chip format `[#path|label]`, `[@server:tool]`
- [x] 5.3 Implement chip widget renderer (CM6 `WidgetType`): distinct colour per sigil type

## 6. Autocomplete: Slash Commands (`/`)

- [x] 6.1 Create CM6 completion source for `/`: triggers on `/`, calls `engine.listCommands` RPC, filters results as user types
- [x] 6.2 On completion select: insert `/<name>` plain text (slash commands resolved at engine level)
- [x] 6.3 Handle empty command list — CM6 returns null from completion source

## 7. Autocomplete: Files + Symbols (`#`)

- [x] 7.1 Create CM6 completion source for `#`: triggers on `#`, calls `workspace.listFiles` RPC
- [x] 7.2 In parallel, call `lsp.workspaceSymbol` RPC for symbol completions
- [x] 7.3 Combine file and symbol results in dropdown with distinct type icons
- [x] 7.4 On file completion select: replace `#query` with `[#src/path/file.ts|file.ts]` chip
- [x] 7.5 On symbol completion select: replace `#query` with `[#path|SymbolName]` chip

## 8. Autocomplete: MCP Tools (`@`)

- [x] 8.1 Create CM6 completion source for `@`: triggers on `@`, calls `mcp.getStatus` RPC
- [x] 8.2 On tool completion select: replace `@query` with `[@server:toolName|toolName]` chip
- [x] 8.3 Handle no-MCP-servers — CM6 returns null from completion source

## 9. Reference Resolution at Send Time

- [x] 9.1 In `ChatEditor.vue` `extractAndSend()`: parse chip markers before emit
- [x] 9.2 For each `[#path|label]` chip: add placeholder file attachment to be resolved server-side
- [x] 9.3 For each `[#path:Lstart-Lend|Symbol]` chip: preserve line range in attachment `data` (`@file:path:L10-L25`); backend resolves as fenced code block with path + range header
- [x] 9.4 For each `[@server:tool]` chip: serialised as chip label in prompt text
- [x] 9.5 Strip chip markers from prompt text (replaced with human-readable label)
- [x] 9.6 Handle file-not-found: backend injects `[File path not found — skipped]` soft notice into prompt; message continues sending

## 10. Wire Editor into TaskDetailDrawer

- [x] 10.1 Replace `<Textarea>` with `<ChatEditor>` in `TaskDetailDrawer.vue`
- [x] 10.2 Paste handler bubbled up via wrapper div for image/file paste support
- [x] 10.3 Verify auto-focus and scroll-to-bottom behaviour is unchanged

## 11. Tests & E2E

- [x] 11.1 Unit test `CopilotEngine.listCommands`: test 3-scope glob, dedup, personal scope, missing dirs
- [x] 11.2 Unit test `ClaudeEngine.listCommands`: test active session returns commands, no session returns `[]`
- [x] 11.3 Unit test `resolvePrompt` Copilot path expansion: worktree → project root → personal fallback chain
- [x] 11.4 Unit test `#` reference send-time resolution: file content injection, 100 KB cap, file-not-found toast
- [x] 11.5 Write and run e2e tests for autocomplete UI: `/` opens picker, `#` shows files, `@` shows MCP tools, chip insertion, chip deletion with Backspace, send resolves `#` to attachment
