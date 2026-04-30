## Why

`src/bun/index.ts` has grown to ~1189 lines by mixing four unrelated concerns in a single flat file: file logging setup, application bootstrap, WebSocket/PTY handling, and broadcast/notification helpers. This makes it impossible to test individual concerns in isolation and forces every contributor to understand the entire file before touching any single concern. The file also contains ~650 lines of dead debug-server endpoints that were never cleaned up after the app migrated away from the WebView architecture.

## What Changes

- **New module**: `src/bun/server/file-logger.ts` — encapsulates `console.*` patching for file-based log rotation
- **New module**: `src/bun/server/broadcast-channel.ts` — `IBroadcastChannel` interface + `BroadcastChannel` class owning the `clients` Set
- **New module**: `src/bun/server/notifications.ts` — `NotificationService` class for all domain push events (task updated, new message, workflow reloaded, chat session updated, config error)
- **New module**: `src/bun/server/stream-processor.ts` — `StreamEventProcessor` class encapsulating stream enrichment, persistence pipeline, and raw-message broadcast
- **New module**: `src/bun/server/websocket.ts` — `WebSocketHandler` class encapsulating PTY WeakMaps and all WS lifecycle handlers
- **New module**: `src/bun/server/shutdown.ts` — `createShutdownHandler()` factory for graceful SIGTERM/SIGINT handling
- **Slim**: `src/bun/index.ts` reduced to ~80-line linear wiring script (composition root only)
- **Delete**: `src/test-review-overlay.ts` — legacy WebView script referencing removed `/inspect`, `/click`, `/screenshot` endpoints
- **Delete**: ~650 lines of dead debug-server endpoints from `index.ts` (zero references in any test); retain only the `/shutdown` endpoint and `DEBUG_PORT` stdout line required by `e2e/api/fixtures/server.ts`
- **Fix**: Add missing `listProjects` import (deleted alongside the dead endpoint that used it)
- No logic changes — pure extraction and deletion of dead code

## Capabilities

### New Capabilities

- `bun-server-modules`: Focused server modules (`file-logger`, `broadcast-channel`, `notifications`, `stream-processor`, `websocket`, `shutdown`) extracted from `index.ts` into `src/bun/server/`, each with a single responsibility

### Modified Capabilities

_(none — this is a structural refactor with no requirement-level behavior changes)_

## Impact

- **`src/bun/index.ts`**: ~1189 → ~80 lines; becomes a pure composition root
- **`src/bun/handlers/code-server.ts`**: no signature change; `broadcast` passed as `channel.broadcast.bind(channel)` from call site
- **`e2e/api/fixtures/server.ts`**: unaffected — still reads `DEBUG_PORT=` stdout and calls `/shutdown`
- **`src/test-review-overlay.ts`**: deleted
- No changes to public API, RPC types, frontend, DB schema, or tests
