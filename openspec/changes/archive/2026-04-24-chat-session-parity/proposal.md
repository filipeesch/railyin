## Why

Standalone chat sessions shipped, but the actual chat experience still diverges from task chat in several important ways. Session chat is missing the shared CodeMirror editor, context usage UX, MCP tools UX, and structured streaming behavior, which breaks the goal that chat should feel the same everywhere and leaves real regressions in day-to-day use.

## What Changes

- Bring session chat onto the same conversation surface as task chat for editor, streaming, and tool UX.
- Use the shared `ChatEditor` in session mode, with autocomplete scoped to the workspace root instead of a task worktree.
- Show context usage and compaction controls in session chat, backed by conversation-scoped usage data.
- Expose MCP tools controls in session chat, using workspace/session-compatible enablement instead of task-only wiring.
- Render structured stream blocks for sessions so tool calls, reasoning, and status updates match task chat.
- Ensure standalone session executions use the configured workspace base path as their working directory for Copilot and Claude.

## Capabilities

### New Capabilities
- `session-chat-parity`: Guarantees standalone sessions expose the same core chat UX as task conversations, with workspace-scoped context where task-scoped context is unavailable

### Modified Capabilities
- `chat-editor`: Extend the shared CodeMirror chat editor to session chat, including workspace-scoped autocomplete behavior
- `context-gauge`: Extend context usage display and manual compaction controls from task chat to session chat
- `mcp-ui`: Extend chat drawer MCP tool controls so they work in standalone session conversations
- `conversation`: Extend shared conversation rendering requirements so session conversations render structured streaming state, tool groups, and reasoning the same way as task conversations
- `workspace`: Clarify workspace-root resolution for standalone chat working directory and workspace-scoped autocomplete

## Impact

- Frontend chat surfaces: `SessionChatView.vue`, `ConversationInput.vue`, `ConversationBody.vue`, `ChatEditor.vue`
- Frontend state: `chatStore`, drawer/session wiring, workspace-backed autocomplete/model/tool state
- Backend chat/session flow: chat session execution context, workspace file listing/autocomplete, conversation context usage
- Specs and tests for shared chat parity across task and session experiences
