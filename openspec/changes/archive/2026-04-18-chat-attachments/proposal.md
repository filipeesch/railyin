## Why

Users need to share images (screenshots, error dialogs, UI mockups, diagrams) with the AI agent inside the chat, the same way GitHub Copilot Chat supports image attachments. Without this, users must describe visuals in text, which is lossy and slow.

## What Changes

- Add a **paste event handler** on the chat Textarea so that `Cmd+V` / `Ctrl+V` with image data in the clipboard creates an image attachment instead of pasting binary garbage
- Add an **attach button** (📎) next to the send button that opens a native file picker accepting `image/*`, supporting multiple files
- Add a **staging chips area** above the Textarea that shows pending attachments with a remove (✕) button each; chips are cleared after the message is sent
- Extend the `tasks.sendMessage` RPC to accept an optional `attachments` array alongside `content`
- Extend `AIMessage.content` in the AI abstraction layer to accept `ContentBlock[]` (text + image blocks) so images can be forwarded to the model API
- Implement image block serialization in the **Claude** and **Copilot** engine adapters; the **native engine is explicitly excluded**
- Store only lightweight attachment metadata (`{ label, type }`) in `conversation_messages.metadata` — raw bytes are **never persisted to the database**
- Render a small chip (`📎 filename.png`) in `MessageBubble.vue` for messages that carry attachment metadata

## Capabilities

### New Capabilities

- `chat-attachments`: Clipboard paste and file-picker attachment flow in the chat compose area, chip rendering in conversation history, and image block forwarding to Claude and Copilot AI providers

### Modified Capabilities

- `conversation`: Message content type extended to support multipart content (text + image blocks) for the current turn; DB storage remains plain text with metadata tags

## Impact

- **UI**: `TaskDetailDrawer.vue`, `MessageBubble.vue`
- **RPC layer**: `shared/rpc-types.ts` — new `Attachment` type, updated `sendMessage` params
- **Backend handler**: `src/bun/handlers/tasks.ts` — accept and thread attachments through `executeHumanTurn`
- **Orchestrator**: `src/bun/engine/orchestrator.ts` — pass attachment data into message assembly
- **AI abstraction**: `src/bun/ai/types.ts` — `AIMessage.content` union type
- **AI providers**: `src/bun/ai/anthropic.ts`, `src/bun/engine/copilot/engine.ts` — serialize image blocks to provider format
- **No new dependencies** — uses browser Clipboard API and native `<input type="file">`
