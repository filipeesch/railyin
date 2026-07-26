## Why

The Pi engine currently relies on a Tavily API integration (`search_internet`) for web search and a simple HTTP `fetch_url` for page retrieval. This requires a third-party API key, cannot render JavaScript-heavy sites, and gives the agent no ability to navigate or extract content like a real user.

## What Changes

- **Browser-backed `web_search` tool**: A new parent-facing tool that spawns a specialized Pi child agent with browser-automation tools.
- **Browser automation tools**: `browser_search`, `browser_navigate`, and `browser_extract` drive a headless Playwright browser.
- **Replace Tavily**: Remove `search_internet` and the `search:` workspace config block; all web search goes through the browser agent.
- **Keep `fetch_url`**: Retained as a fast fallback, implemented via Playwright/shared fetch with the same HTML stripping.
- **Shared child-session runner**: Extract a reusable runner from `delegate.ts` for `web_search`. The `delegate` tool remains disabled on `main`; we reuse its child-session lifecycle code without re-enabling the tool.
- **Add child event streaming infrastructure**: The previous `delegateEmitRef` plumbing was removed in the Pi engine refactor. New infrastructure is required in `engine.ts`/`PiToolFactory` so `web_search` child events appear as nested subagent bubbles in the UI.

## Capabilities

### New Capabilities
- `web-search-agent`: Parent tool that triggers a browser-based research agent and returns a markdown summary with sources.
- `browser-search-tool`, `browser-navigate-tool`, `browser-extract-tool`: Low-level browser tools used by the child agent.

### Modified Capabilities
- `pi-web-tools`: Replaces Tavily search with browser-centric tools; `fetch_url` uses Playwright/stripping.
- `pi-delegate-tool`: Source of the child-session runner pattern extracted for `web_search`; the tool itself remains disabled.
- `pi-engine` / `pi-tool-factory`: Passes child-spawning dependencies into `PiToolFactory.buildTools()` / `buildAllTools()` and adds subagent event streaming infrastructure.

## Test Scenarios

### Unit tests — `web_search` tool (`src/bun/test/pi/web-search.test.ts`)
- **WS-1**: Child session receives only browser tools (`browser_search`, `browser_navigate`, `browser_extract`) — no file-system, delegate, or board tools.
- **WS-2**: Step limit is enforced; when the hard limit is exceeded the runner returns a result asking the agent to summarize its findings.
- **WS-3**: The parent receives the child agent's final markdown response, including a `Sources` section listing visited URLs.
- **WS-4**: Child tool events are forwarded as `isInternal` events under the `web_search` subagent bubble.
- **WS-5**: Abort signal is respected and cleans up the child session and browser session.
- **WS-6**: Browser automation errors are surfaced as `isError` tool results.

### Unit tests — browser tools (`src/bun/test/pi/browser-tools.test.ts`)
- **BT-1**: `browser_search` returns sanitized HTML from the injected fake browser session.
- **BT-2**: `browser_navigate` updates and returns the current URL.
- **BT-3**: `browser_extract` returns markdown/text from the current page.
- **BT-4**: Browser session is closed in `finally` even when a tool throws.
- **BT-5**: `browser_search` surfaces navigation/search errors as `isError` results.
- **BT-6**: `browser_extract` after `browser_navigate` uses the last navigated URL.

### Unit tests — HTML sanitizer (`src/bun/test/pi/html-sanitizer.test.ts`)
- **HS-1**: Removes `<script>` and `<style>` blocks entirely.
- **HS-2**: Removes `<head>`, `<meta>`, `<link>`, and HTML comments.
- **HS-3**: Preserves content tags (`<a>`, `<p>`, `<div>`, `<span>`, `<h1>`–`<h6>`, `<li>`, `<tr>`, etc.) and link URLs.
- **HS-4**: Collapses excessive whitespace and decodes common HTML entities.
- **HS-5**: `htmlToMarkdown` produces readable markdown from sanitized HTML.

### Unit tests — `fetch_url` fallback (`src/bun/test/pi/web-tools.test.ts` or extend browser-tools tests)
- **FU-1**: `fetch_url` returns sanitized text/markdown for an HTML page.
- **FU-2**: `fetch_url` respects the timeout and reports timeout as an error.
- **FU-3**: `fetch_url` reports HTTP errors (`4xx`/`5xx`) as `isError` results.
- **FU-4**: `fetch_url` truncates large responses to the configured limit.

### Refactor-preservation tests — delegate (`src/bun/test/pi/delegate.test.ts`)
- Existing delegate tests continue to pass after extracting `child-runner.ts`.
- Child event forwarding, loop detection, and subagent bubbles remain intact.

### Config / validation tests
- **CV-1**: `validatePiEngineConfig` rejects `harness.web_search.max_steps` below 1 or above 100.
- **CV-2**: `PiEngineConfig` no longer exposes `SearchConfig`; TypeScript compilation fails if `search:` is accessed on `WorkspaceYaml`.

### Engine wiring tests (`src/bun/test/pi/web-search-engine-wiring.test.ts` or extend existing engine tests)
- **EW-1**: `PiToolFactory.buildTools()` passes child-spawning dependencies into `buildWebTools`.
- **EW-2**: `web_search` tool events emitted via `delegateEmitRef` appear on the execution queue.
- **EW-3**: `buildAllTools` includes `web_search` when the `web` group is active and omits it otherwise.

### Tool display tests
- **TD-1**: `buildPiToolDisplay` returns sensible labels/subjects for `web_search`, `browser_search`, `browser_navigate`, and `browser_extract`.

### Integration / Playwright UI tests (optional follow-up)
- A UI spec can seed persisted messages with `parent_tool_call_id: webSearchCallId` to verify nested rendering, similar to `delegate-rendering.spec.ts`.
- No real browser is required for the initial test suite.

## Impact

- `src/bun/engine/pi/tools/web.ts` — refactored; adds `web_search`, removes `search_internet`.
- `src/bun/engine/pi/tools/delegate.ts` — extracts shared runner logic.
- `src/bun/engine/pi/tools/child-runner.ts` — new shared child-session runner.
- `src/bun/engine/pi/tools/browser.ts` — new Playwright browser automation tools with an injectable `BrowserSession` interface for testability.
- `src/bun/engine/pi/tools/html-sanitizer.ts` — new HTML cleaning utility.
- `src/bun/test/pi/web-search.test.ts` — unit tests for the `web_search` tool using mock child and browser sessions.
- `src/bun/test/pi/browser-tools.test.ts` — unit tests for browser tools using a fake `BrowserSession`.
- `src/bun/test/pi/html-sanitizer.test.ts` — unit tests for HTML sanitization and markdown conversion.
- `src/bun/test/pi/web-tools.test.ts` — unit tests for `fetch_url` fallback behavior.
- `src/bun/test/pi/web-search-engine-wiring.test.ts` — tests for dependency threading and event streaming.
- `src/bun/engine/pi/child-session.ts` — adds browser-agent system-prompt suffix option.
- `src/bun/engine/pi/tools/index.ts` — extends `AllToolsOptions` and passes child-spawning deps into `buildWebTools()`.
- `src/bun/engine/pi/tool-factory.ts` — accepts child-spawning deps in `buildTools()` and forwards them to `buildAllTools()`.
- `src/bun/engine/pi/engine.ts` — creates `delegateEmitRef`, passes it through `PiToolFactory.buildTools()`, and wires it to the `startExecution()` queue.
- `src/bun/engine/pi/tools/delegate.ts` — source of the runner pattern; remains disabled.
- `src/bun/engine/pi/tools/display.ts` — adds display metadata for new tools.
- `src/bun/config/index.ts` — adds `harness.web_search` config, removes `SearchConfig`.
- `config/workspace.yaml.sample` — removes `search:` block, documents browser search.
- `package.json` — moves Playwright to runtime dependencies.

> **Tests are part of this change and use dependency-injected mocks (fake child sessions and fake browser sessions) to keep the suite fast and deterministic.**
