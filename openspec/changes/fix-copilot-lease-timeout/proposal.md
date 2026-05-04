## Why

The Copilot engine lease expires after 10 minutes of idle *event* time, killing the CLI process and crashing active chat streams mid-response — leaving tasks incorrectly marked as `failed`. Three bugs compound the problem: eviction fires unconditionally even when a session is actively streaming, long-running tools suppress the watchdog's lease-touch so truly long tool invocations starve the lease, and the resulting socket error is not recognised as a graceful cancellation.

## What Changes

- **Eviction guard**: eviction is suppressed when `activeSessions > 0`; the lease timer is reset instead
- **Watchdog heartbeat**: `translateCopilotStream` calls an `onHeartbeat` callback on every watchdog fire (even when tools are in flight) so the engine can keep the lease warm during long tool runs
- **Graceful pre-eviction abort**: before evicting a pool entry the adapter notifies registered callbacks; the engine uses this hook to abort its `AbortController` and signal a `cancelled` outcome rather than a fatal error — preventing tasks from landing in `failed`
- **DI cleanup**: `LeaseRegistry`, `_taskCliPool`, and `_statusListeners` are moved from module-level singletons to instance variables on `DefaultCopilotSdkAdapter`; `CopilotSdkAdapter` gains `onBeforeEvict` as a first-class interface method

## Capabilities

### New Capabilities

_(none)_

### Modified Capabilities

- `engine-session-lifecycle`: add requirements for (1) eviction suppression while active sessions exist and (2) graceful pre-eviction abort that yields a `cancelled` outcome instead of `failed`
- `copilot-engine`: add requirement that the watchdog heartbeat fires during tool execution to keep the lease alive

## Impact

- `src/bun/engine/copilot/session.ts` — eviction guard, `onBeforeEvict` hook, DI refactor, export `DefaultCopilotSdkAdapter`
- `src/bun/engine/copilot/events.ts` — `onHeartbeat` parameter and injectable `idleTimeoutMs`/`maxSilenceCount` on `translateCopilotStream`
- `src/bun/engine/copilot/engine.ts` — wire `onHeartbeat`, `evictionController`, `unsubEvict`
- No API surface, RPC types, or DB schema changes
- Tests are covered in the companion change `fix-copilot-lease-timeout-tests`
