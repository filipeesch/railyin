# Spec: test-cross-engine-context

## Purpose

Specifies behavior of the `CrossEngineContextInjector` — when it injects cross-engine context, what that context contains, and how it persists engine state across turns.

## Requirements

### Requirement: CEC-injection-trigger
`CrossEngineContextInjector.prepareSwitch()` injects only when the engine type changes.

#### Scenario: CEC-1 same engine — no injection
- **WHEN** `conversations.last_engine_type === targetQmid.engineId`
- **THEN** `prepareSwitch()` returns `undefined`

#### Scenario: CEC-2 null last_engine_type — no injection (first ever turn)
- **WHEN** `conversations.last_engine_type IS NULL`
- **THEN** `prepareSwitch()` returns `undefined`

#### Scenario: CEC-3 engine type changes — context block returned
- **WHEN** `last_engine_type === "copilot"` and `targetQmid.engineId === "claude"`
- **THEN** `prepareSwitch()` returns a `{ prefixedUserContent: string }` where content starts with `<message_history>`

#### Scenario: CEC-4 context block contains messages since last compaction anchor
- **WHEN** DB has a `compaction_summary` message and later assistant/user turns
- **THEN** the returned context block includes only the turns after the compaction anchor

---

### Requirement: CEC-last-engine-type-persistence
`last_engine_type` is updated after execution regardless of outcome.

#### Scenario: CEC-5 success path updates last_engine_type
- **WHEN** execution completes successfully with `targetQmid.engineId === "claude"`
- **THEN** `conversations.last_engine_type = "claude"` in DB

#### Scenario: CEC-6 failure path still updates last_engine_type
- **WHEN** execution fails midway
- **THEN** `conversations.last_engine_type` is still updated to the target engine ID

---

### Requirement: CEC-compaction-threshold
Pre-switch compaction is triggered when token estimate exceeds 75% of target context window.

#### Scenario: CEC-7 no contextWindow on target — skip threshold check, inject
- **WHEN** `targetQmid` resolves to a model with no `contextWindow` (e.g., `copilot/auto`)
- **THEN** compaction check is skipped; context is injected without pre-compaction

#### Scenario: CEC-8 under threshold — compact NOT called
- **WHEN** estimated tokens < 75% of target `contextWindow`
- **THEN** source engine's `compact()` is NOT called

#### Scenario: CEC-9 over threshold, source HAS compact — compact called, messages re-fetched
- **WHEN** estimated tokens > 75% of target `contextWindow` AND `sourceEngine.compact` is defined
- **THEN** `compact()` is awaited, messages are re-fetched from DB after compaction

#### Scenario: CEC-10 over threshold, source has NO compact (Claude) — warning, injection proceeds
- **WHEN** estimated tokens > 75% AND `sourceEngine.compact === undefined`
- **THEN** a warning is logged and injection proceeds with available messages (no compact)

---

### Requirement: CEC-user-message-injection
Injected context block is prepended to the first user message content; `systemInstructions` is NOT modified.

#### Scenario: CEC-11 injected block prepended to user message content, system prompt unchanged
- **WHEN** executor has existing `systemInstructions` and `prepareSwitch()` returns a `{ prefixedUserContent }` result
- **THEN** the user message sent to the engine starts with `<message_history>`, followed by the original user content; `systemInstructions` is identical to what it would be without injection
