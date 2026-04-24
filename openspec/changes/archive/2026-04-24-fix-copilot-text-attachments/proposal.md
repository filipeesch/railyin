## Why

The Copilot engine silently drops plain-text file uploads and `#file` chip references — they never reach the model. Three implementation bugs introduced during the attachment pipeline build prevent text content from being serialized correctly. Images work fine because they follow a different code path. The regression blocks a core workflow: attaching source files to tasks and chat sessions when using the Copilot engine.

## What Changes

- **Fix Bug 1**: Remove reference to unimported `mime` package in the text-attachment branch; replace with a static mediaType-to-extension map (or `.txt` fallback).
- **Fix Bug 2**: Add the missing `writeFileSync(tmpPath, text)` call so the Copilot CLI binary can read the temp file it is handed via `filePath`.
- **Fix Bug 3**: Reuse `parseFileRef()` from `resolve-file-attachments.ts` to strip the `:L10-L25` line-range suffix before calling `readFileSync`, and slice the resulting content to the specified range.
- **Export `parseFileRef`** from `resolve-file-attachments.ts` so the engine can import it.
- **Add unit tests** to `copilot-rpc-scenarios.test.ts` covering all three failure cases.
- **Add Playwright e2e tests** for `#file` chip attachment delivery in both task chat and session chat.

## Capabilities

### New Capabilities

_None — this change fixes existing behavior; no new user-facing capabilities are introduced._

### Modified Capabilities

- `copilot-engine`: Adding attachment-delivery requirements that are currently absent from the spec. The engine SHALL correctly map text attachments (uploaded files and `#file` chip references, including line-ranged refs) to Copilot SDK `selection` attachments and deliver them to the model on the same turn they are sent.

## Impact

- **`src/bun/engine/copilot/engine.ts`** — three targeted bug fixes in the `mappedAttachments` block (lines 219–231).
- **`src/bun/utils/resolve-file-attachments.ts`** — export `parseFileRef` (one-word change).
- **`src/bun/test/copilot-rpc-scenarios.test.ts`** — three new unit test cases.
- **`e2e/ui/`** — new Playwright suite covering task chat and session chat with `#file` chip attachments.
- No API changes, no new npm dependencies (avoiding adding `mime` as a dependency).
