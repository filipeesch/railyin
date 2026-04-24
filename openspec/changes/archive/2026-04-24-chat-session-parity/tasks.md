## 1. Session editor parity

- [x] 1.1 Switch session input from the plain textarea path to `ChatEditor`
- [x] 1.2 Make session autocomplete resolve against the active workspace root
- [x] 1.3 Preserve existing submit/newline/disabled behavior in session mode

## 2. Session context usage parity

- [x] 2.1 Add session-compatible context usage loading using conversation-scoped APIs
- [x] 2.2 Show the context gauge and context popover in session chat
- [x] 2.3 Wire manual compaction controls for standalone sessions

## 3. Session MCP parity

- [x] 3.1 Expose the MCP tools button in session chat
- [x] 3.2 Add session-compatible MCP enablement persistence and loading
- [x] 3.3 Ensure session turns use the selected MCP tool set

## 4. Structured streaming parity

- [x] 4.1 Feed standalone sessions through the shared structured stream rendering path
- [x] 4.2 Render tool groups, reasoning, and status blocks in session chat
- [x] 4.3 Verify session turns no longer rely on token-only fallback behavior

## 5. Workspace-root execution behavior

- [x] 5.1 Resolve session execution cwd from workspace config
- [x] 5.2 Preserve compatible fallback behavior for workspaces missing `workspace_path`

## 6. Validation

- [x] 6.1 Add or update UI coverage for session editor, context gauge, MCP, and structured streaming parity
