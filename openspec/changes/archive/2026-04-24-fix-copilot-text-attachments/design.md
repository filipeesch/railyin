## Context

The Copilot engine maps `Attachment[]` objects to `CopilotSdkAttachment[]` before calling `session.send()`. This mapping logic, introduced in the attachment pipeline build, contains three bugs that cause text attachments and `#file` chip references to silently fail or crash before reaching the Copilot CLI binary.

The Copilot CLI binary receives attachments verbatim via JSON-RPC. For `selection`-type attachments it is handed a `{ filePath, displayName, text?, selection? }` object. Empirically, the CLI reads content from `filePath` on disk rather than from the optional inline `text` field.

Current attachment flow:
```
ChatEditor → extractChips → Attachment[]
  → prepareMessageForEngine (pass-through for Copilot engine)
  → CopilotEngine._run() → mappedAttachments block (lines 219-231)
     ↓           ↓             ↓
  @file ref    text upload   image/binary
  (Bug 3)      (Bug 1+2)     (works fine)
  crashes      crashes        → blob attachment ✓
```

## Goals / Non-Goals

**Goals:**
- Fix all three bugs in the `mappedAttachments` block so text uploads and `#file` refs reach the model.
- Keep the fix self-contained: no new npm dependencies, no architectural changes.
- Cover each fix with a unit test and add Playwright e2e coverage for chip-to-model delivery.

**Non-Goals:**
- Changing how images or binary blobs are handled (different code path, works correctly).
- Changing how non-Copilot engines handle attachments (`prepareMessageForEngine` inject path).
- Supporting multi-file `@file:` batch refs (out of scope).
- Making `filePath` absolute (tracked separately — existing tests mask the issue).

## Decisions

### Decision 1: Remove `mime` dependency — use a static extension map

**Problem**: `mime.extension(mediaType)` is called but `mime` is never imported. Additionally, `mime` is not in `package.json`.

**Chosen approach**: Replace with a small inline static map:
```
"text/plain" → ".txt"
"text/html" → ".html"
"text/css" → ".css"
"text/javascript" → ".js"
"application/json" → ".json"
"application/yaml" → ".yaml"
(default) → ".txt"
```

**Alternative considered**: Add `mime` as a dependency. Rejected because it adds a runtime dependency for a non-critical cosmetic concern (the extension only affects the temp file name, not functionality).

**Alternative considered**: Always use `.txt` regardless of mediaType. Rejected because losing extension on `.json` files confuses the Copilot CLI's language detection.

---

### Decision 2: Write temp file to disk AND pass inline `text`

**Problem**: `writeFileSync(tmpPath, text)` is missing, so the Copilot CLI receives a `filePath` that doesn't exist on disk.

**Chosen approach**: Add `writeFileSync(tmpPath, text, "utf8")` immediately before `toSelectionAttachment()`. Also continue passing `text` inline in the `selection` attachment in case a future SDK version uses it.

**Rationale**: The SDK `selection` type has `text?: string` (optional). The CLI binary currently reads from `filePath`. Writing both is the safest strategy.

---

### Decision 3: Reuse `parseFileRef` for line-ranged `@file:` refs

**Problem**: `a.data.match(/^@file:(.+)$/)?.[1]` returns `"src/foo.ts:L10-L25"` for line-ranged refs, which is then passed directly to `readFileSync()` causing ENOENT.

**Chosen approach**: Export `parseFileRef()` from `resolve-file-attachments.ts` (one-word change) and import it in `engine.ts`. Use it to extract `{ filePath, startLine, endLine }`, read the file, then slice the lines if a range is specified.

**Alternative considered**: Inline a second regex to strip the `:L\d+-L\d+` suffix. Rejected because `parseFileRef` already exists, is tested, and is the canonical parser for this format. Duplication would create drift risk.

---

### Decision 4: Unit tests per bug, not one integration test

Each of the three bugs maps to a distinct failure mode. One test per bug gives:
- Clear failure messages on regression
- Independent coverage of the mime-fallback, disk-write, and line-slice logic

The existing `copilot-rpc-scenarios.test.ts` mock infrastructure (`MockCopilotSession.sentMessages`) is sufficient — no new test scaffolding needed.

---

### Decision 5: Playwright e2e as API-spy tests, not visual-only

The most robust signal is intercepting the `tasks.sendMessage` / `chatSessions.sendMessage` API call and asserting the `attachments` payload contains a `@file:` or base64 text entry. Visual chip rendering is a secondary assertion.

## Risks / Trade-offs

- **Temp file accumulation** → Mitigation: files are written to `$TMPDIR/railyin-attachments/`. The OS clears this periodically. A cleanup pass is explicitly out of scope for this fix.
- **Relative vs. absolute `filePath` passed to Copilot CLI** → The `toSelectionAttachment` helper passes the path as-is. If `@file:` refs are relative (from git ls-files), the CLI may not resolve them. This is a pre-existing issue masked by existing tests; not introduced by this fix. Tracked separately.
- **Line-range slicing is 1-based, off-by-one risk** → `parseFileRef` returns `startLine`/`endLine` as 1-based integers. The slice must use `lines.slice(startLine - 1, endLine)`.
