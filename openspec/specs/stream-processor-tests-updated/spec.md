## Purpose
Specifies the updated `stream-processor.test.ts` scenarios after `StreamBatcher` removal, where real in-memory DB buffers are injected into `StreamProcessor` instead.

## Requirements

### Requirement: SP-1 through SP-6 — injected buffers replace StreamBatcher
SP-1..SP-6 in `stream-processor.test.ts` are rewired to use real in-memory DB buffers injected into `StreamProcessor` instead of testing against `StreamBatcher`.

#### Scenario: SP-1 text chunk persisted to stream_events
- **WHEN** a `text_chunk` event is processed
- **THEN** after flush, `stream_events` table contains the enriched event with correct `seq`

#### Scenario: SP-2 tool_call triggers ConvMessageBuffer flush
- **WHEN** a `tool_call` event is processed
- **THEN** `ConvMessageBuffer.flush()` is called and `onNewMessage` fires with a real ID

#### Scenario: SP-3 onNewMessage fires once per boundary message
- **WHEN** a sequence of events ending at `done` is processed
- **THEN** `onNewMessage` spy call count equals the number of boundary-flushed messages

#### Scenario: SP-4 raw model messages buffered to RawMessageBuffer
- **WHEN** raw model messages arrive during streaming
- **THEN** they accumulate in `RawMessageBuffer` until count-threshold or manual flush

#### Scenario: SP-5 done event triggers all buffer flushes
- **WHEN** a `done` event is processed
- **THEN** `ConvMessageBuffer`, `RawMessageBuffer`, and stream event `WriteBuffer` are all flushed

#### Scenario: SP-6 cancel event triggers cleanup flushes
- **WHEN** a `cancel` event is processed
- **THEN** all buffers are flushed and execution state is updated
