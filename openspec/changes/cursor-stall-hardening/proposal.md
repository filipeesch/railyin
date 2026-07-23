## Why

Cursor engine chats (`cursor/composer-2.5` and similar) occasionally break mid-run with an unhandled `ConnectError: [internal] Session closed with error code 6`, originating from `@connectrpc/connect-node`'s internal HTTP/2 session management inside `@cursor/sdk`. Investigation (see `notes/` history and upstream `connectrpc/connect-es` issues #1678, #1561, #683) confirmed this is a known, currently-unfixed upstream transport bug: an HTTP/2 stream/session can be torn down mid-flight without the SDK's own error/retry paths ever observing it, so `run.wait()` never resolves and the affected tool call or run silently stalls — with no fatal event reaching the UI. A separate, always-on bug (`translate-events.ts` reading a non-existent field for `status` events) was also found during this investigation and is fixed alongside the primary hardening. No SDK/library version upgrade resolves the root cause; mitigation must live in Railyin.

## What Changes

- Call `Cursor.configure({ local: { useHttp1ForAgent: true } })` once during Cursor SDK initialization to force local-agent SDK streams onto HTTP/1.1 + SSE instead of HTTP/2, sidestepping the `Http2SessionManager` failure class documented upstream. This is the primary/first-line fix.
- Add a per-run inactivity ("stall") watchdog inside `CursorEngine`/`InProcessCursorAdapter`: reset a timer on every translated `EngineEvent`; if no event arrives for a configurable threshold while the execution is still `running` (not `waiting_user`/suspended), abort the run and yield a fatal `EngineEvent.error`. This is a generic backstop independent of the exact internal failure mechanism, and only applies to Cursor-engine runs. The threshold is two-tiered: a strict threshold (default 5 min) applies while idly waiting on the assistant/SDK, and a separate, more generous threshold (default 30 min) applies while a tool call (SDK built-in or custom) is in flight, so a long-running shell command isn't mistaken for a dead session.
- Fix `translate-events.ts`'s `case "status"` handler to read `message.status` instead of the non-existent `message.message`, so `RUNNING`/`FINISHED`/`ERROR` status transitions are correctly forwarded to the UI (currently always empty).
- Add structured logging of the `Session closed with error code 6` rejection pattern, tagged with `execution_id` where derivable, so future occurrences are traceable instead of anonymous unhandled-rejection log lines.
- Harden the existing "Engine session lost; restarted as new execution" resume-recovery path (`human-turn-executor.ts`) to be triggered proactively by the watchdog's fatal error, not only reactively when `CursorEngine.resume()` throws.

## Capabilities

### New Capabilities
(none — this hardens the existing Cursor SDK integration capability)

### Modified Capabilities
- `cursor-sdk`: adds a per-run stall watchdog requirement, an HTTP/1.1 transport configuration requirement, and corrects the `status` event translation behavior.

## Impact

- `src/bun/engine/cursor/inprocess-adapter.ts` — add watchdog timer lifecycle around the run loop.
- `src/bun/engine/cursor/engine.ts` — wire watchdog-triggered fatal errors into existing error-handling/resume-recovery flow.
- `src/bun/engine/cursor/translate-events.ts` — fix `status` event field read.
- `src/bun/engine/cursor/sdk-init.ts` (or equivalent init site) — add `Cursor.configure({ local: { useHttp1ForAgent: true } })` call.
- `src/bun/engine/execution/human-turn-executor.ts` — no structural change expected, but verify the fallback path handles watchdog-triggered failures identically to `resume()`-throw failures.
- No DB schema changes. No RPC/API contract changes. No frontend changes beyond the now-populated `status` message field flowing through existing UI status rendering.
- Tests: extends existing unit suites (`inprocess-adapter.test.ts`, `translate-events.test.ts`) and the existing RPC-level integration harness (`cursor/rpc-scenarios.test.ts`, backed by a real in-memory DB) — no new mocks, DI seams, or refactoring required, since injectable fakes/constructor params already exist for every seam this change touches (including a new `stallTimeoutMs` constructor param on `InProcessCursorAdapter`, mirroring `DefaultCopilotSdkAdapter`'s existing `deadline` param). No Playwright coverage is added; see `design.md`/`tasks.md` for the full test plan.
