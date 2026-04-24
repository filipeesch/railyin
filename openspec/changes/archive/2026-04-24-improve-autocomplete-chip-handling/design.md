## Context

The current CodeMirror chip flow treats autocomplete chips as an editor-only presentation detail. When a message is sent, the frontend replaces chip tokens with plain labels, so `/`, `#`, and `@` semantics are lost in the persisted user message. That creates two problems:

- conversation bubbles no longer show structured references as chips
- slash commands selected from autocomplete lose the leading `/` before the engine sees the prompt, so command resolution fails

This change touches the shared chat editor, both task and standalone session send paths, conversation rendering, and engine-facing conversation/context assembly. Older messages do not need migration or backfill.

## Goals / Non-Goals

**Goals:**
- Preserve autocomplete chip structure for newly sent user messages
- Render preserved user-message chips as rich chips in conversation bubbles
- Keep sigils visible in chip labels in both the editor and sent-message UI
- Continue sending clean engine text, with slash commands preserved and file references handled through attachments
- Keep new behavior consistent across task chat and standalone session chat

**Non-Goals:**
- Migrating or rewriting previously stored plain-text messages
- Changing how code-reference chips from the external editor are serialized
- Adding new chip types beyond slash, file/symbol, and MCP tool chips
- Changing command discovery, attachment resolution, or engine provider lookup order

## Decisions

### 1. Store chip markup as the canonical content for newly sent user messages

Newly sent user messages will persist the structured chip document in `conversation_messages.content` instead of flattening chips to plain labels. This makes the stored message suitable for rich re-rendering in the conversation timeline and keeps the UI faithful to what the user actually selected.

**Alternatives considered**
- Store rich chip content in message metadata: cleaner separation, but duplicates the message payload and complicates existing conversation consumers.
- Keep storing plain text and reconstruct chips from attachments: lossy for inline ordering and impossible for `@` tool references.

### 2. Derive engine-facing plain text from chip markup at execution time

Before a current user turn or prior conversation history is sent to an engine, the system will decode chip markup into plain/raw prompt text. The derived text will preserve sigils where they are semantically meaningful to the engine (`/command`, `@tool`) and produce clean human text for file/symbol references, while attachments continue carrying the actual file payload.

This keeps engines unaware of the internal `[ref|label]` markup while restoring slash-command behavior.

**Alternatives considered**
- Send chip markup directly to the engine: would leak custom syntax into model prompts and still require special slash decoding.
- Derive engine text from chip refs instead of visible labels: more precise for paths, but noisier than the user-authored text and unnecessary for slash commands.

### 3. Use sigil-prefixed labels for visible chip text

Chip labels shown in the editor and conversation bubbles will include their sigil:

- slash commands: `/command`
- file/symbol references: `#file` or `#Symbol`
- MCP tool references: `@tool`

The chip reference payload remains the structured source of truth for attachment extraction and engine-specific handling.

**Alternatives considered**
- Preserve only the existing plain labels and rely on icons alone: too subtle, and it does not solve the slash-command bug.
- Show full MCP `server:tool` in every chip: more precise, but visually noisier than needed for the common case.

### 4. Keep old messages untouched and tolerate mixed history

Only newly created messages will persist chip markup. Existing plain-text messages stay as they are. Conversation rendering and engine context assembly must therefore tolerate mixed history:

- new messages with chip markup are decoded/rendered structurally
- older plain-text messages pass through unchanged

This avoids a migration while keeping the new behavior safe to roll out incrementally.

## Risks / Trade-offs

- **[Stored content is no longer plain text]** -> Any engine/context path that forwards `conversation_messages.content` directly will leak chip markup unless it explicitly decodes user-message content first.
- **[Mixed old/new history]** -> Renderers and context builders must treat chip parsing as opportunistic, not mandatory, so older messages continue working unchanged.
- **[MCP label ambiguity]** -> Showing `@tool` instead of `@server:tool` is friendlier, but duplicate tool names across servers could be less specific; the structured chip ref still preserves the exact target.
- **[Longer persisted user content]** -> Stored chip markup is slightly noisier than plain text, but it buys faithful rendering and deterministic derivation for engines.

## Migration Plan

1. Update chip-label generation in the editor to include sigils.
2. Split chip handling into two projections:
   - stored/rendered markup content
   - derived engine-facing plain/raw text plus attachments
3. Update task and session send flows to persist markup content while sending derived text into execution paths.
4. Update conversation rendering to parse and display user-message chips.
5. Update conversation/history assembly to decode stored chip markup before engine calls.
6. Leave existing messages unchanged; no backfill or rollback migration is required.

## Open Questions

None at proposal time. The explored behavior is settled: slash commands keep `/`, file references stay attachment-driven, and old messages do not need migration.
