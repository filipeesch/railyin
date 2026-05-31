## ADDED Requirements

### Requirement: draftStore unit-level correctness

#### Scenario: DR-1 — get returns null when no draft exists
- **WHEN** `draftStore.get('task:1')` is called and no entry exists for that key
- **THEN** the return value is `null`

#### Scenario: DR-2 — set then get round-trips the text
- **WHEN** `draftStore.set('task:1', 'hello')` is called and then `draftStore.get('task:1')` is called
- **THEN** the returned entry's `text` equals `'hello'`

#### Scenario: DR-3 — clear removes the entry
- **WHEN** `draftStore.set('task:1', 'hello')` is called and then `draftStore.clear('task:1')` is called
- **THEN** `draftStore.get('task:1')` returns `null`

#### Scenario: DR-4 — eviction removes entries older than 7 days
- **WHEN** an entry's `savedAt` timestamp is older than 7 days and `_evictStale()` is called
- **THEN** the entry is removed from localStorage

#### Scenario: DR-5 — eviction keeps entries younger than 7 days
- **WHEN** an entry's `savedAt` timestamp is 6 days old and `_evictStale()` is called
- **THEN** the entry is retained

#### Scenario: DR-6 — task and session keys are isolated
- **WHEN** `draftStore.set('task:1', 'task draft')` and `draftStore.set('session:1', 'session draft')` are called
- **THEN** each key's value is independent and retrievable separately

### Requirement: draft persistence survives navigation (E2E)

#### Scenario: DR-E2E-1 — draft survives Chat→Info→Chat tab switch (task)
- **WHEN** a user types text in a task's conversation input and switches to the Info tab
- **THEN** the typed text is still present when the user switches back to the Chat tab

#### Scenario: DR-E2E-2 — draft survives drawer close and reopen (task)
- **WHEN** a user types text in a task's conversation input and closes the task drawer
- **THEN** the typed text is restored when the user reopens the same task drawer

#### Scenario: DR-E2E-3 — draft survives page reload
- **WHEN** a user types text in a task's conversation input and the page is reloaded
- **THEN** the typed text is restored when the user opens the same task drawer

#### Scenario: DR-E2E-4 — draft is cleared after send
- **WHEN** a user sends a message from the conversation input
- **THEN** the conversation input is empty after send
- **AND** the draft is not restored on next open

#### Scenario: DR-E2E-5 — two tasks have isolated drafts
- **WHEN** a user types text in Task A's conversation input, then opens Task B and types different text
- **THEN** reopening Task A shows Task A's original draft text
- **AND** Task B shows Task B's draft text

#### Scenario: DR-E2E-6 — session draft survives tab switch
- **WHEN** a user types text in a chat session's conversation input and switches to the Decisions tab
- **THEN** the typed text is still present when the user switches back to the Chat tab
