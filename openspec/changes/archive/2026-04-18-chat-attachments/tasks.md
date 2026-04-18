## 1. Shared Types

- [x] 1.1 Add `Attachment` interface to `src/shared/rpc-types.ts` with fields `label: string`, `mediaType: string`, `data: string` (base64)
- [x] 1.2 Add `ContentBlock` union type to `src/bun/ai/types.ts`: `{ type: "text"; text: string } | { type: "image"; mediaType: string; data: string }`
- [x] 1.3 Update `AIMessage.content` in `src/bun/ai/types.ts` to `string | null | ContentBlock[]`

## 2. Backend — RPC & Orchestrator

- [x] 2.1 Extend `tasks.sendMessage` handler in `src/bun/handlers/tasks.ts` to accept optional `attachments?: Attachment[]` in params
- [x] 2.2 Pass `attachments` through to `orchestrator.executeHumanTurn` — update the method signature
- [x] 2.3 In `orchestrator.executeHumanTurn`, when assembling the current-turn user message, convert `attachments` to `ContentBlock[]` and set `AIMessage.content` as an array (text block + image blocks)
- [x] 2.4 Persist attachment metadata only: write `{ attachments: [{ label, type }] }` to `conversation_messages.metadata` — no base64 in DB

## 3. AI Providers — Image Block Serialization

- [x] 3.1 Update `adaptMessages` in `src/bun/ai/anthropic.ts` to handle `AIMessage.content` as `ContentBlock[]` — map image blocks to `{ type: "image", source: { type: "base64", media_type, data } }` in `AnthropicUserContentBlock`
- [x] 3.2 Update `toWireMessage` in `src/bun/ai/openai-compatible.ts` to handle `ContentBlock[]` — map image blocks to `{ type: "image_url", image_url: { url: "data:<mediaType>;base64,<data>" } }`

## 4. UI — Compose Area

- [x] 4.1 Add `pendingAttachments: Ref<Attachment[]>` state to `TaskDetailDrawer.vue`
- [x] 4.2 Add `paste` event handler on the `<Textarea>` — detect `image/*` items in `clipboardData`, read as base64, push to `pendingAttachments` (suppress default paste for images only)
- [x] 4.3 Add hidden `<input type="file" accept="image/*" multiple ref="fileInput">` and a 📎 `<Button>` that triggers it; on `change` event read selected files as base64 and push to `pendingAttachments`
- [x] 4.4 Enforce limits: reject attachments over 5 MB or when count would exceed 3; show error toast via PrimeVue `useToast`
- [x] 4.5 Render staging chips above the `<Textarea>`: `v-for` over `pendingAttachments`, each chip shows `📎 <label>` and a ✕ button that splices it from the array
- [x] 4.6 Update the `send()` function to include `attachments: pendingAttachments.value` in the `taskStore.sendMessage` call, then clear `pendingAttachments` after send
- [x] 4.7 Update `taskStore.sendMessage` in `src/mainview/stores/task.ts` to forward optional `attachments` in the RPC call

## 5. UI — Message History

- [x] 5.1 Update `MessageBubble.vue` to read `chunk.metadata?.attachments` and render a chip row (`📎 <label>`) below the message text for user messages with attachments

## 6. Verification

- [x] 6.1 Manual test: paste a screenshot, verify chip appears, send, verify AI receives and responds to the image, verify DB metadata has no base64
- [x] 6.2 Manual test: use file picker to attach 2 images, remove one with ✕, send with one — verify only 1 attachment forwarded
- [x] 6.3 Manual test: verify attachment chip renders correctly in conversation history after send
- [x] 6.4 Run existing backend test suite (`bun test src/bun/test --timeout 20000`) — confirm no regressions
