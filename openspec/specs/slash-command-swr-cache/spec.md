## Purpose
TBD — defines the stale-while-revalidate cache composable for slash command lists, keyed by task.

## Requirements

### Requirement: Slash command list is cached per task with stale-while-revalidate semantics
The system SHALL maintain a module-level cache of slash commands keyed by `taskId`. On every request, the cache SHALL return the most recently fetched list immediately if one exists, then trigger a background refresh. The background refresh SHALL be skipped if a refresh is already in progress (`revalidating: true`) or if the last successful fetch occurred less than 30 minutes ago. The UI SHALL update only if the refreshed list differs from the cached list (sorted JSON equality). If the cache is empty for a task, the system SHALL await the fetch before returning, ensuring the first call always returns a real result.

#### Scenario: First open for a task returns real result after fetch
- **WHEN** the user types `/` for the first time for a given `taskId` (no cache entry)
- **THEN** the system awaits `engine.listCommands` and returns the fetched list (no stale return)

#### Scenario: Subsequent open returns cached list immediately
- **WHEN** the user types `/` and a cache entry exists for that `taskId`
- **THEN** the command list is returned from cache synchronously without waiting for the network

#### Scenario: Background refresh updates UI when list has changed
- **WHEN** the background refresh for a task completes and the new list differs from the cached list
- **THEN** the reactive command ref is updated so the next picker open reflects the new commands

#### Scenario: Background refresh is silent when list is unchanged
- **WHEN** the background refresh completes and the new list is identical to the cached list (same names and descriptions, order-insensitive)
- **THEN** no reactive update is triggered and the UI is not re-rendered

#### Scenario: Parallel refresh calls are deduplicated
- **WHEN** the user opens the picker twice in quick succession while a background refresh is already running
- **THEN** only one refresh call is made; the second trigger is skipped because `revalidating` is `true`

#### Scenario: Refresh is skipped within 30-minute window
- **WHEN** the last successful fetch occurred less than 30 minutes ago
- **THEN** no background refresh is triggered and the cached list is returned as-is
