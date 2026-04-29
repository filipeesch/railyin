## Purpose
Specifies the updated `backend-rpc-runtime.ts` helper after `StreamBatcher` removal, replacing execution-scoped buffer state with DI-constructed in-memory DB buffers.

## Requirements

### Requirement: BRT-1 StreamBatcher map fully removed
The `backend-rpc-runtime.ts` helper must not reference `StreamBatcher`. All execution-scoped buffer state is replaced by DI-constructed in-memory DB buffers.

#### Scenario: Runtime constructs DI buffers
- **WHEN** `createBackendRpcRuntime()` is called
- **THEN** `ConvMessageBuffer`, `RawMessageBuffer`, and `WriteBuffer<PersistedStreamEvent>` are constructed with the in-memory DB and injected into `StreamProcessor`

### Requirement: BRT-2 11 existing stream-pipeline scenarios remain passing
The two-channel IPC vs DB split scenarios in `stream-pipeline-scenarios.test.ts` must pass unchanged after the `StreamBatcher` removal.

#### Scenario: All 11 scenarios green
- **WHEN** `bun test src/bun/test --timeout 20000` is run
- **THEN** all 11 scenarios in `stream-pipeline-scenarios.test.ts` pass

### Requirement: BRT-3 `getDbStreamEvents()` unchanged
The `getDbStreamEvents()` helper that queries `stream_events` directly from the DB is not modified.

#### Scenario: DB stream events queryable post-migration
- **WHEN** `getDbStreamEvents(executionId)` is called after a processed stream
- **THEN** returns the persisted stream events from the in-memory DB
