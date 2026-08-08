## Why

Today `chatSessions.create` sets a fixed placeholder title (`Chat – Mon DD`) for standalone chat sessions. There is no way to get a meaningful, user-meaningful title. Other agents (Cursor, etc.) auto-generate a concise title from the user's first prompt. We want the same behavior: when a fresh session receives its first message, generate a short, readable title from that prompt in the background and push it to the sidebar.

## What Changes

A new `SessionTitleGenerator` service that, when a session still carries the placeholder title, issues a one-off prompt to the active model (resolved from the conversation's engine) to summarize the first user prompt into a short title, then persists it and pushes a `chatSession.updated` event.

- **Hook**: `chatSessions.sendMessage` — detect untitled session, fire async generation (does not block the send).
- **Detection**: match the `Chat – Mon DD` placeholder pattern (renameable sessions are never overwritten).
- **Mechanism**: generic cross-engine — a per-engine `generateTitle` capability, resolved via `engineRegistry.resolveEngineForModel`; engines that don't support it degrade to keeping the placeholder.
- **Behavior**: fire-and-forget async; on failure keep the placeholder and log (never an empty/broken title). Always-on, no config flag.
- **DI change**: `chatSessionHandlers` gains `SessionTitleGenerator` as a required 4th dependency (it currently does not receive the engine registry). Composition root constructs the generator once; every existing factory call site (tests + root) is updated.
- **Frontend**: no changes — the existing `chatSession.updated` push already updates `title` in the store.

## Impact

- **`src/bun/handlers/chat-sessions.ts`**: wire generation into `sendMessage`; extend the factory DI signature.
- **New `src/bun/conversation/session-title-generator.ts`**: the service (sanitize + persist + push), fully injectable for tests.
- **Engine layer**: add optional `generateTitle` capability (per-engine adapters; Pi can reuse the child-session pattern).
- **DB**: only writes `chat_sessions.title`; no schema change.
- **RPC/UI**: reuses the existing `chatSession.updated` push — no new endpoints or frontend changes.
- **Tests**: new `session-title-generator.test.ts` (unit, fake engines); extend `handlers.test.ts` (integration + DI regression).

## Non-Goals

- No new DB columns or schema migrations.
- No config flag / opt-in gate (always-on).
- No blocking of the user's first response (generation runs async).
- No changes to task conversations — only standalone chat sessions.
