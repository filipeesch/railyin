## Overview

A `SessionTitleGenerator` service generates a short, readable title from the first user prompt of a standalone chat session, async, and pushes it via the existing `chatSession.updated` event. It is wired into `chatSessions.sendMessage`, resolves the engine from the conversation's model via `EngineRegistry.resolveEngineForModel`, and calls an optional per-engine `generateTitle` capability. Engines that don't support it degrade to keeping the placeholder.

## Architecture

```
chatSessions.sendMessage
        │  (fetch session row; session.title still matches placeholder?)
        ▼
   SessionTitleGenerator.generateIfUntitled(session)   ── fire-and-forget (void)
        │
        ├─ resolve engine: EngineRegistry.resolveEngineForModel(wsKey, conversation_model)
        ├─ engine.generateTitle({ prompt: firstUserPrompt })   → string | null
        ├─ sanitizeTitle(result)                                → string | null
        ├─ UPDATE chat_sessions SET title=? WHERE id=?          (only if non-null)
        └─ fetchChatSessionWithModel + onSessionUpdated(session)  → chatSession.updated push
```

## DI surface change (composition root + tests)

`chatSessionHandlers` is currently a 3-arg factory: `chatSessionHandlers(db, onSessionUpdated, orchestrator)`. It does **not** receive the `EngineRegistry` — it delegates to the orchestrator for engine work. Auto-title needs engine resolution, so the factory SHALL gain the `SessionTitleGenerator` as a dependency.

- **New factory signature**: `chatSessionHandlers(db, onSessionUpdated, orchestrator, sessionTitleGenerator)`.
- **Composition root**: construct `SessionTitleGenerator(db, engineRegistry, notifyChatSessionUpdated)` once and pass it in.
- **Test impact**: every existing call site in `src/bun/test/handlers.test.ts` must add the generator arg. Tests SHALL construct a real `SessionTitleGenerator` backed by an in-memory DB + a fake engine registry (or a stub generator) so the existing suites continue to pass.

## Components

### 1. Placeholder detection (shared, in `session-title-generator.ts`)

```ts
// Matches "Chat – Mon DD", e.g. "Chat – Apr 21"
export const AUTO_TITLE_PATTERN = /^Chat\s+–\s+\w{3}\s+\d{1,2}$/;

export function isAutoPlaceholder(title: string): boolean {
  return AUTO_TITLE_PATTERN.test(title.trim());
}
```

Used by both the handler (to decide whether to fire) and the generator (re-check before writing — concurrency guard).

### 2. `SessionTitleGenerator` (new `src/bun/conversation/session-title-generator.ts`)

```ts
export class SessionTitleGenerator {
  constructor(
    private db: Database,
    private registry: EngineRegistry,
    private onSessionUpdated: (session: ChatSession) => void,  // notifier.notifyChatSessionUpdated
  ) {}

  /** Fire-and-forget: called with void, never rejects the caller. */
  async generateIfUntitled(session: ChatSession): Promise<void> {
    if (!isAutoPlaceholder(session.title)) return;      // already titled / user renamed
    const title = await this.oneShotTitle(session);
    if (!title) return;                                 // failure -> keep placeholder (fallback)
    db.run("UPDATE chat_sessions SET title = ? WHERE id = ?", [title, session.id]);
    const updated = fetchChatSessionWithModel(db, session.id)!;
    this.onSessionUpdated(updated);
  }

  private async oneShotTitle(session: ChatSession): Promise<string | null> {
    try {
      const engine = this.registry.resolveEngineForModel(session.workspace_key, session.conversation_model);
      if (!engine.generateTitle) return null;           // engine lacks capability -> degrade
      const raw = await engine.generateTitle({
        prompt: firstUserPrompt(session),
        workingDirectory: /* workspace path */,
      });
      return sanitizeTitle(raw);
    } catch (err) {
      console.error("[chat-sessions] title generation failed", err);
      return null;
    }
  }
}
```

All three constructor deps are injectable/mockable (no hidden globals). This is the seam for the unit tests below.

### 3. `firstUserPrompt(session)`

Fetch the earliest `user` message content from `conversation_messages` for this conversation (first prompt). Truncate to a reasonable window (e.g. first 400 chars) before sending to the model.

### 4. `sanitizeTitle(raw)`

```ts
function sanitizeTitle(raw: string | null): string | null {
  if (!raw) return null;
  let t = raw.trim().replace(/\s*\n\s*/g, " ").replace(/[*_`]/g, "");
  if (!t) return null;
  if (t.length > 40) t = t.slice(0, 40).trimEnd() + "…";
  return t;
}
```

- Never returns empty — if sanitized result is empty, returns `null` (placeholder fallback).
- Strips markdown/code fences so the sidebar shows clean text.
- Caps at ~40 chars.

### 5. Per-engine `generateTitle` capability

Add an **optional** method to the engine interface (`src/bun/engine/types.ts`):

```ts
generateTitle?(params: { prompt: string; workingDirectory: string }): Promise<string | null>;
```

Per-engine adapters:
- **Pi**: implement via the existing child-session pattern (`ChildSessionFactory`) — spawn an in-memory child session with a single user prompt (`Summarize this into a short title: <prompt>`), dispose immediately, return the assistant text.
- **Copilot / Claude / Cursor / OpenCode**: issue a one-off completion via their existing SDK call path. If an engine cannot support this yet, the method is absent → `generateTitle` returns null → placeholder fallback (safe, always-on).

### 6. Wiring in `chatSessions.sendMessage` (`src/bun/handlers/chat-sessions.ts`)

After fetching session, before `executeChatTurn`:

```ts
if (isAutoPlaceholder(session.title)) {
  void sessionTitleGenerator.generateIfUntitled(session);  // fire-and-forget, non-blocking
}
```

The generator is a constructor dependency (DI), shared across the handler.

## Data flow / persistence

- **Write**: only `chat_sessions.title` (existing column, no migration).
- **Read**: `fetchChatSessionWithModel(db, id)` — existing helper returns the full `ChatSession` row with `conversation_model`.
- **Push**: `onSessionUpdated(updated)` → `notifier.notifyChatSessionUpdated` → `{type:"chatSession.updated"}` → frontend store already updates `title` (no frontend change).

## Concurrency & failure handling

- **Race guard**: `generateIfUntitled` re-checks `isAutoPlaceholder(title)` before writing. If two sends race, the second sees the first's new (non-placeholder) title and skips → no double-write.
- **Failure**: any exception or empty result → return `null` → keep placeholder, log. Never leaves an empty/broken title.
- **Retry**: if generation fails, the placeholder remains, so a later send retries naturally (self-healing).
- **Lifecycle**: fire-and-forget via `void` — the generator catches all errors internally; it never rejects the send path.

## Testability (aligned with existing suites)

- **Test seam**: `SessionTitleGenerator(db, registry, onSessionUpdated)` is fully injectable; fake engines register into the registry exactly as `engine-registry.test.ts` does.
- **Unit tests** (`session-title-generator.test.ts`): placeholder detection, sanitize, generator behavior against fake engines (supports / lacks / throws), race guard, renamed-session guard.
- **Integration** (`handlers.test.ts`): the factory DI change is exercised; `sendMessage` fires `void` generation on placeholder (non-blocking) and skips on titled/renamed; updated push observed via the injected `onSessionUpdated`.
- **Existing call sites** must be updated for the new factory arg — the DI change is the main regression surface.

## Non-Goals

- No schema migration (no new columns).
- No blocking of the user's first response.
- No config flag / gating (always-on).
- No changes to task conversations.
- No frontend changes (existing `chatSession.updated` push covers it).
