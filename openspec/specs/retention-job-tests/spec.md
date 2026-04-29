## Purpose
Specifies the test contract for `RetentionJob`, which periodically deletes stale `model_raw_messages` and `stream_events` rows on a timer loop.

## Requirements

### Requirement: RJ-1 `runNow()` deletes stale raw messages
`RetentionJob.runNow()` deletes all `model_raw_messages` rows with `created_at` older than 1 day.

#### Scenario: Old raw messages deleted, fresh rows survive
- **GIVEN** rows with `created_at` = now-25h and now-30min in `model_raw_messages`
- **WHEN** `runNow()` is called
- **THEN** the 25h-old row is deleted; the 30-min-old row remains

### Requirement: RJ-2 `runNow()` deletes stale stream events
`RetentionJob.runNow()` deletes all `stream_events` rows with `created_at` older than 4 hours.

#### Scenario: Old stream events deleted, recent rows survive
- **GIVEN** rows with `created_at` = now-5h and now-1h in `stream_events`
- **WHEN** `runNow()` is called
- **THEN** the 5h-old row is deleted; the 1h-old row remains

### Requirement: RJ-3 Timer loop — runs on startup then every 5 min
`RetentionJob.start()` calls `runNow()` immediately (no initial wait), then loops: `await waitFn(5min)` → `runNow()`.

#### Scenario: Immediate run on start
- **WHEN** `start()` is called
- **THEN** `runNow()` fires once before any tick

#### Scenario: Each tick triggers another run
- **WHEN** `tick()` is called N times
- **THEN** `runNow()` has been called N+1 times (1 initial + N ticks)

### Requirement: RJ-4 `stop()` halts the loop
#### Scenario: Stop prevents further runs
- **WHEN** `stop()` is called
- **THEN** subsequent `tick()` calls do not trigger `runNow()`
