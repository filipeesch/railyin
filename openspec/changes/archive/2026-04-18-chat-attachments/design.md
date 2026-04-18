## Context

The app has a Vue 3 chat interface (`TaskDetailDrawer.vue`) where users type text messages sent to an AI agent. The `tasks.sendMessage` RPC accepts `{ taskId, content: string }`. The AI abstraction layer (`src/bun/ai/types.ts`) represents messages as `AIMessage { role, content: string | null }`. Anthropic's `anthropic.ts` adapter already knows how to produce `ContentBlock[]` arrays for tool results — the image block type just needs to be added. The Copilot engine routes through `openai-compatible.ts` which maps to the OpenAI wire format.

The native engine uses a different message assembly path (`src/bun/engine/native/`) and is **explicitly out of scope** — no image support there.

## Goals / Non-Goals

**Goals:**
- Let users paste any file from clipboard (`Cmd+V`) into the chat compose area (images, PDFs, text files, etc.)
- Let users attach any file via a file picker button (📎), multiple files allowed
- Show staging chips above the Textarea, removable before send
- Forward attachments to Claude and Copilot providers with per-engine MIME-type translation for the current turn only
- Render a lightweight `📎 filename` chip in `MessageBubble.vue` for messages that had attachments
- Never write raw bytes to the SQLite database

**Non-Goals:**
- Native engine attachment support
- Persisting attachment bytes for future AI turns (attachments are one-shot)
- File preview / lightbox (chip only, no thumbnail in history)
- Drag-and-drop (clipboard + file picker only)

## Decisions

### D1: No bytes in the DB — metadata tag only

**Decision:** Store only `{ attachments: [{ label: string, type: string }] }` in `conversation_messages.metadata`. Raw base64 bytes live only in frontend memory until the API call completes.

**Rationale:** Images are one-shot reference material. The AI doesn't need them in subsequent turns. A 1MB screenshot stored as base64 = ~1.3MB per message in SQLite — that accumulates badly. The metadata tag is enough to render the history chip.

**Alternative considered:** Inline base64 in `content` JSON. Rejected: bloats DB, no retrieval benefit.

### D2: Extend `AIMessage.content` to `string | null | ContentBlock[]`

**Decision:** Add a `ContentBlock` union type to `src/bun/ai/types.ts`:
```ts
export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; mediaType: "image/png" | "image/jpeg" | "image/gif" | "image/webp"; data: string };

export interface AIMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null | ContentBlock[];
  ...
}
```

**Rationale:** The Anthropic adapter already handles `AnthropicUserContentBlock[]` for tool results — adding an image variant is a natural extension. The OpenAI-compatible adapter can map `ContentBlock[]` to the `{ type: "image_url", image_url: { url: "data:..." } }` format. All providers that don't receive array content continue to work as-is (the type union is backwards-compatible).

**Alternative considered:** Separate `images` field on `AIMessage`. Rejected: more awkward to serialize, diverges from provider wire formats.

### D3: Attach base64 only on current turn — not replayed from DB

**Decision:** When assembling conversation history from the DB for context, user messages are loaded as plain text (`content` string). The attachment base64 is only available when the frontend passes it in the `sendMessage` RPC call. The orchestrator appends the `ContentBlock[]` form only for the *new* user message of the current turn.

**Rationale:** We don't store bytes, so we can't replay them. This is acceptable — images are reference material for the immediate response, not long-running context.

**Trade-off:** If a user says "fix what was wrong in the screenshot" in a later turn, the AI won't remember the image unless the user re-attaches it.

### D4: `sendMessage` params extended, not replaced

**Decision:** Extend the RPC params:
```ts
// existing
{ taskId: number; content: string }
// new
{ taskId: number; content: string; attachments?: Attachment[] }

// Attachment (shared type)
export interface Attachment {
  label: string;         // filename or "pasted-image.png"
  mediaType: string;     // "image/png", "image/jpeg", etc.
  data: string;          // base64 encoded bytes
}
```

Plain text messages remain unchanged (no `attachments` key).

### D5: Attach button + clipboard paste — both funnel to the same staging state

**Decision:** A single `pendingAttachments: Ref<Attachment[]>` in `TaskDetailDrawer.vue` is populated by either:
1. A `paste` event handler on the `<Textarea>` (checks `clipboardData.items` for any file kind)
2. A hidden `<input type="file" accept="*" multiple>` triggered by the 📎 button

Both paths read the file/blob as a `base64` data URL, strip the `data:...;base64,` prefix, and push an `Attachment` object. On send, the array is included in the RPC call and then cleared.

### D6: Per-engine MIME-type translation — UI agnostic

**Decision:** The UI always sends `{ label, mediaType, data }` — no filtering by file type. Each engine adapter is responsible for translating attachments to the appropriate SDK format:

| MIME type | Claude adapter | Copilot engine |
|-----------|---------------|----------------|
| `image/*` | `ImageBlockParam` (base64) | `blob` attachment |
| `application/pdf` | `DocumentBlockParam` (base64) | `blob` attachment |
| `text/*`, `application/json`, `application/yaml` | inline `text` block with fenced code | `selection` attachment (`text` field) |
| anything else | silently skipped | `blob` (provider decides) |

**Rationale:** Keeps the UI decoupled from provider capabilities. The Copilot SDK only processes image blobs — text blobs are silently ignored. The `selection` attachment type (`{ type: "selection", filePath, displayName, text }`) is the SDK's native way to pass inline text content (same mechanism VS Code uses for selected code). For Claude Code SDK, `DocumentBlockParam` via the CLI relay is less reliable than a plain `text` block with fenced content. Both approaches avoid polluting the prompt string.

**Rationale:** Adding support for a new MIME type on a specific engine only requires changing that engine's adapter — zero UI changes.

## Risks / Trade-offs

- **Large images** → base64 sent in RPC payload. Mitigation: cap at 5MB per attachment, 3 attachments max. Enforce on the frontend before pushing to `pendingAttachments`.
- **Non-vision models** → if the user selects a non-vision-capable model, the Copilot/Claude provider will return an API error. Mitigation: the error surfaces in the chat as a system message (existing error path). Future work could detect vision capability at the model level.
- **Native engine excluded** → if a task somehow uses the native engine and the user attaches an image, the attachment is silently dropped (bytes not forwarded). The text message still sends. Mitigation: the 📎 UI can detect engine type from the task's model field and show a tooltip; or simply document the limitation.
- **Clipboard API permissions** → the `paste` event fires without permissions, so no browser permission prompt needed. File picker is also permission-free.
