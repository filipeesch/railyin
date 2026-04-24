## 1. Prerequisites

- [x] 1.1 Export `parseFileRef` from `src/bun/utils/resolve-file-attachments.ts` by adding the `export` keyword to its function declaration
- [x] 1.2 Add `writeFileSync` to the `fs` import in `src/bun/engine/copilot/engine.ts`

## 2. Bug Fixes (engine.ts lines 219–231)

- [x] 2.1 Fix Bug 1: Replace `mime.extension(a.mediaType)` with an inline static extension map (`"text/plain"→".txt"`, `"application/json"→".json"`, `"application/yaml"→".yaml"`, etc.) with `.txt` as the fallback
- [x] 2.2 Fix Bug 2: Add `writeFileSync(tmpPath, text, "utf8")` immediately before the `toSelectionAttachment()` call in the text-upload branch
- [x] 2.3 Fix Bug 3: Replace the raw `readFileSync(filePathRef, "utf8")` call with `parseFileRef`-based parsing — extract `{ filePath, startLine, endLine }`, read the file, then slice to the specified line range (1-based, inclusive) when a range is present

## 3. Unit Tests (copilot-rpc-scenarios.test.ts)

- [x] 3.1 Add test: text attachment with extension-less label (e.g. `label: "README"`, `mediaType: "text/plain"`) → `sentMessages[0].attachments[0]` is a `selection` with `filePath` ending in `.txt` and correct `text`
- [x] 3.2 Add test: text attachment → temp file at `filePath` exists on disk (`existsSync(filePath)`) with correct content
- [x] 3.3 Add test: `@file:` ref with line range (e.g. `@file:some-file.ts:L2-L4`) → `selection.text` contains only those lines; `selection.selection` reflects start/end positions

## 4. Playwright E2E Tests

- [x] 4.1 Add test in `e2e/ui/chat.spec.ts`: in task chat, type `#` to trigger chip autocomplete, select a file, send message → intercept `tasks.sendMessage` API call and assert `attachments[0].data` matches `@file:` pattern (covered by existing AC-9 and AC-32 in autocomplete.spec.ts)
- [x] 4.2 Add test in session chat spec: same flow for `chatSessions.sendMessage` — chip is inserted, message is sent, API payload includes the attachment (added CD-K-1 to chat-session-drawer.spec.ts)
- [x] 4.3 Add test: chip token renders as a styled inline element (not as raw `[#path|label]` text) in the chat editor before sending (covered by AC-5 in autocomplete.spec.ts; added CD-K-2 for session chat)
- [x] 4.4 Run the full e2e suite (`bun run build && npx playwright test e2e/ui/`) and confirm no regressions

