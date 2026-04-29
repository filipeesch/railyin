## Purpose
Specifies the test contract for `StreamEventEnricher`, which assigns stable `blockId` groupings and monotonically increasing `seq` values to enriched stream events.

## Requirements

### Requirement: SEE-1 Block ID assignment by event type
`StreamEventEnricher.enrich()` assigns a stable `blockId` that groups events of the same logical block (e.g., all tokens for a single assistant reply share one `blockId`).

#### Scenario: New block starts on type boundary
- **WHEN** an event of a new type follows an event of a different type
- **THEN** `blockId` increments

#### Scenario: Consecutive same-type events share block ID
- **WHEN** multiple events of the same type arrive in sequence
- **THEN** all share the same `blockId`

### Requirement: SEE-2 Monotonically increasing seq
Every event enriched by a single `StreamEventEnricher` instance receives a unique, monotonically increasing `seq` value starting at 0.

#### Scenario: Seq increments per event
- **WHEN** N events are enriched
- **THEN** their `seq` values are `[0, 1, ..., N-1]`

### Requirement: SEE-3 Per-execution instance
Each `StreamEventEnricher` is instantiated per execution. A new instance resets `blockId` and `seq` to 0.

#### Scenario: New instance resets counters
- **WHEN** a new `StreamEventEnricher` is created
- **THEN** the first enriched event has `seq=0` regardless of any previous instance
