## ADDED Requirements

### Requirement: Auto-generate session title from first prompt

When a standalone chat session still carries the auto placeholder title (`Chat – Mon DD`), receiving its first user message SHALL trigger an asynchronous, non-blocking title generation:

- The `SessionTitleGenerator` SHALL resolve the engine from the conversation's model via `EngineRegistry.resolveEngineForModel`.
- It SHALL call the engine's optional `generateTitle({ prompt, workingDirectory })` capability. Engines lacking the capability SHALL keep the placeholder (graceful degrade).
- On success, the generated title SHALL be sanitized (trimmed, collapsed to one line, markdown stripped, capped at ~40 chars), persisted to `chat_sessions.title`, and pushed via the existing `chatSession.updated` event.
- On failure or empty result, the placeholder SHALL be kept and an error logged — the session SHALL never have an empty or broken title.

#### Scenario: Fresh session gets a meaningful title

- **WHEN** a session whose title still matches `AUTO_TITLE_PATTERN` receives its first message, and the engine supports `generateTitle`
- **THEN** a title derived from the first user prompt SHALL be written to `chat_sessions.title` and a `chatSession.updated` push SHALL reach the frontend

#### Scenario: Renamed session is never overwritten

- **WHEN** a session's title no longer matches `AUTO_TITLE_PATTERN` (e.g. the user renamed it)
- **THEN** no title generation SHALL run and the existing title SHALL be preserved

#### Scenario: Generation fails keeps placeholder

- **WHEN** `generateTitle` throws or returns an empty result
- **THEN** the placeholder title SHALL be kept and an error SHALL be logged

#### Scenario: Engine without generateTitle capability degrades

- **WHEN** the resolved engine does not implement `generateTitle`
- **THEN** the placeholder title SHALL be kept, with no crash and no title overwrite

#### Scenario: Title generation does not block the send

- **WHEN** `chatSessions.sendMessage` detects an untitled session
- **THEN** it SHALL fire generation as `void` (fire-and-forget) and the real turn SHALL execute immediately without waiting for the title

#### Scenario: Concurrent sends do not double-write

- **WHEN** two `generateIfUntitled` calls race on the same placeholder-titled session and the first succeeds
- **THEN** the second SHALL re-check the title before writing, see the new non-placeholder title, and skip — no double-write

### Requirement: Handler DI exposes SessionTitleGenerator

The `chatSessionHandlers` factory SHALL accept `SessionTitleGenerator` as a required dependency.

#### Scenario: Composition root injects the generator

- **WHEN** the factory is invoked at the composition root or in tests
- **THEN** the caller SHALL pass a `SessionTitleGenerator` constructed with the DB, `EngineRegistry`, and the `chatSession.updated` notifier, and `sendMessage` SHALL use it for placeholder-titled sessions

#### Scenario: Existing call sites updated for the new argument

- **WHEN** the factory signature changes to include `SessionTitleGenerator`
- **THEN** the composition root and every call site in `handlers.test.ts` SHALL be updated for the new argument, and the full test suite SHALL pass
