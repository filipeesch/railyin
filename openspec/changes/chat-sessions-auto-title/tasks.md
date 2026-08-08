## Tasks

### 1. Placeholder detection helper

- [ ] 1.1 Add `AUTO_TITLE_PATTERN` (`/^Chat\s+–\s+\w{3}\s+\d{1,2}$/`) and `isAutoPlaceholder(title)` in `src/bun/conversation/session-title-generator.ts`.

### 2. `SessionTitleGenerator` service (new `src/bun/conversation/session-title-generator.ts`)

- [ ] 2.1 Add `SessionTitleGenerator` class with constructor `(db, registry, onSessionUpdated)` — all injectable (test seam).
- [ ] 2.2 Implement `generateIfUntitled(session)` — re-checks `isAutoPlaceholder`, resolves engine, calls `generateTitle`, sanitizes, `UPDATE chat_sessions SET title=?`, then `fetchChatSessionWithModel` + `onSessionUpdated`.
- [ ] 2.3 Implement `oneShotTitle(session)` — resolves engine via `EngineRegistry.resolveEngineForModel`, guards on `engine.generateTitle` presence, catches all errors → `null`.
- [ ] 2.4 Implement `firstUserPrompt(session)` — fetch earliest `user` message content for the conversation, truncate to ~400 chars.
- [ ] 2.5 Implement `sanitizeTitle(raw)` — trim, collapse newlines, strip markdown, cap ~40 chars with ellipsis, return `null` if empty.

### 3. Engine capability (`src/bun/engine/types.ts`)

- [ ] 3.1 Add optional `generateTitle?(params: { prompt: string; workingDirectory: string }): Promise<string | null>` to the engine interface.

### 4. Per-engine `generateTitle` adapters

- [ ] 4.1 Pi: implement `generateTitle` reusing the existing `ChildSessionFactory` (single prompt, dispose immediately).
- [ ] 4.2 Copilot: implement `generateTitle` via its one-off completion path.
- [ ] 4.3 Claude: implement `generateTitle` via its one-off completion path.
- [ ] 4.4 Cursor: implement `generateTitle` via its one-off completion path (or leave absent → graceful degrade).
- [ ] 4.5 OpenCode: implement `generateTitle` via its one-off completion path (or leave absent → graceful degrade).

### 5. DI surface change (`src/bun/handlers/chat-sessions.ts` + composition root)

- [ ] 5.1 Extend `chatSessionHandlers` factory to `(db, onSessionUpdated, orchestrator, sessionTitleGenerator)` — the generator is a required 4th dependency.
- [ ] 5.2 Construct `SessionTitleGenerator(db, engineRegistry, notifyChatSessionUpdated)` once at the composition root and pass it in.
- [ ] 5.3 Update every existing factory call site (tests + root) for the new arg.

### 6. Wiring in `chatSessions.sendMessage`

- [ ] 6.1 After fetching session and before `executeChatTurn`, fire `void sessionTitleGenerator.generateIfUntitled(session)` only when `isAutoPlaceholder(session.title)`.

### 7. Unit tests — new `src/bun/test/session-title-generator.test.ts`

- [ ] 7.1 Placeholder detection: matches `Chat – Apr 21`, `Chat – Apr 2` (single-digit day), rejects renamed/titled values.
- [ ] 7.2 `sanitizeTitle`: trims, collapses newlines, strips markdown, caps ~40 chars with ellipsis, returns `null` on empty.
- [ ] 7.3 Fake engine with `generateTitle` (registered in registry like `engine-registry.test.ts`): `generateIfUntitled` writes title to `chat_sessions.title` and calls `onSessionUpdated`.
- [ ] 7.4 Fake engine **without** `generateTitle`: placeholder kept, no write, no crash.
- [ ] 7.5 Fake engine that **throws**: placeholder kept, error logged, no crash.
- [ ] 7.6 Race guard: second `generateIfUntitled` after first success sees non-placeholder title and skips (no double-write).
- [ ] 7.7 Renamed-session guard: title not matching placeholder → never overwritten.

### 8. Integration tests — extend `src/bun/test/handlers.test.ts`

- [ ] 8.1 Update existing `chatSessionHandlers(...)` call sites for the new 4th arg (regression).
- [ ] 8.2 `sendMessage` on a placeholder-titled session fires generation as `void` (non-blocking) — real turn still executes immediately.
- [ ] 8.3 `sendMessage` on a titled/renamed session does **not** fire generation.
- [ ] 8.4 Observe the `chatSession.updated` push via the injected `onSessionUpdated` after a successful title write.

### 9. Engine adapter tests

- [ ] 9.1 Pi `generateTitle` via `ChildSessionFactory` — single prompt, dispose, returns text.
- [ ] 9.2 Other engines: `generateTitle` adapter returns text or is absent → graceful degrade.

### 10. Verification

- [ ] 10.1 Fresh session with first message gets a meaningful title async, pushed via `chatSession.updated`.
- [ ] 10.2 A renamed session (title no longer matches placeholder) is never overwritten.
- [ ] 10.3 Failed generation keeps placeholder + logs (no empty/broken title).
- [ ] 10.4 Engines without `generateTitle` degrade to placeholder (no crash).
- [ ] 10.5 No blocking of the user's first response; no config flag.
- [ ] 10.6 Full test suite passes after the DI surface change.
