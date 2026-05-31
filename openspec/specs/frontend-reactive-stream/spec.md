# Spec: Frontend Reactive Stream State

## Overview

Requirements for how the frontend manages live stream state across concurrent conversations.

## Requirements

### R1 — In-place mutation

Stream state mutations (block append, block update, roots push) MUST be applied directly to the reactive Map and Array without replacing the parent container reference.

Rationale: Vue 3 tracks `Map.set(key)` and `Array.push()` natively via its collection-aware Proxy. Replacing `streamStates.value` triggers a cascade re-evaluation of all computed properties depending on the Map; in-place mutation triggers only the specific key's dependants.

### R2 — No global version counter

There MUST NOT be a global reactive counter whose sole purpose is to force downstream computeds to re-evaluate. Any component that needs to react to a specific block changing MUST subscribe to that block's reactive reference directly.

### R3 — Per-conversation lifecycle

Each entry in `streamStates` MUST be fully removed (deleted from the Map) when the conversation's execution completes AND the conversation is not currently active. Retaining a cleared-but-present Map entry is not permitted — the entry MUST be deleted.

When a conversation becomes active, its stream state is loaded from the server via `loadMessages`. There is no in-memory state to recover from a deleted entry.

#### Scenario: Completed non-active stream state is deleted
- **WHEN** a `done` stream event arrives for a conversation that is not currently the active conversation
- **THEN** the `streamStates` Map entry for that conversation ID is fully deleted (not merely cleared)

#### Scenario: Completed active stream state triggers reload
- **WHEN** a `done` stream event arrives for the currently active conversation
- **THEN** `loadMessages` is called to refresh conversation content from the server, and the `streamStates` entry is retained with `isDone: true` until the next `selectTask`/`selectSession`

#### Scenario: SB-5 — done for non-active conversation removes the entry
- **WHEN** a `done` stream event arrives for a conversation that is not currently active
- **THEN** `streamStates.get(conversationId)` returns `undefined`

#### Scenario: SB-9 — non-active conversation entry is not accessible after done
- **WHEN** a `done` stream event arrives for a non-active conversation
- **THEN** `streamStates.get(conversationId)` returns `undefined`
- **AND** no cleared shell entry exists in the Map

#### Scenario: SS-3 — queue drain for background task does not contaminate active view (E2E)
- **WHEN** a background task completes (triggering queue drain) while the user is viewing a different task
- **THEN** the active task's conversation view shows no new messages
- **AND** no streaming content from the background task is visible in the active view

### R4 — No object spread on reactive blocks

`StreamBlock` objects inside a reactive Map MUST NOT be spread into new objects on read (e.g., `{ ...block }`). This defeats Vue 3.4's computed value stability optimization which skips downstream re-renders when the returned reference hasn't changed.

### R5 — Context usage cleanup

`contextUsageByConversation` MUST delete the entry for a conversation when that conversation is deactivated (`setActiveConversation(null)` or a different id). The entry is re-populated on next open via `fetchContextUsage`.

### R6 — Changed file counts cleanup on task deletion

The frontend SHALL remove the changed file count entry for a task when that task is deleted. When a task is deleted, the task's entry in `changedFileCounts` MUST be deleted.

### Requirement: Copilot subagent tool calls are visible in the live stream
The system SHALL NOT suppress tool call events that have a `parentCallId` from appearing in the live stream. Only tools that are truly internal (skill source prefix, `report_intent`, `internal_*`, `copilot_*`) SHALL be suppressed via `isInternal`.

#### Scenario: Subagent tool call appears as child block during streaming
- **WHEN** a Copilot subagent emits a `tool_call` event with `parentToolCallId` set
- **THEN** the stream event is emitted with `isInternal: false` and appears as a child block under its spawning tool in the live stream

#### Scenario: report_intent remains suppressed
- **WHEN** a Copilot event has `toolName === 'report_intent'`
- **THEN** `isInternal` is `true` and the event is not emitted to the UI

### Requirement: Horizontal scrollbar is suppressed in the chat conversation panel
The system SHALL set `overflow-x: hidden` on the `.conv-body` element in `ConversationBody.vue` so that wide child content (ReadView, FileDiff, pre blocks) does not propagate a horizontal scrollbar to the outer chat panel.

#### Scenario: Long file content does not cause outer horizontal scroll
- **WHEN** a ReadView renders a file with lines longer than the panel width
- **THEN** only the ReadView scrolls horizontally; the conversation panel shows no horizontal scrollbar
