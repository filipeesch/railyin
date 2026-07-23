## 1. Extract shared child-session runner

- [ ] 1.1 Create `src/bun/engine/pi/tools/child-runner.ts` exporting `runChildSession(opts)` that encapsulates child session creation, event forwarding, loop detection, subagent bubbles, raw-model observability, and disposal.
- [ ] 1.2 Refactor `src/bun/engine/pi/tools/delegate.ts` to use `runChildSession` for each parallel child task, removing duplicated subscribe/emit/dispose logic.

## 2. Dependencies and config

- [ ] 2.1 Move/add Playwright to runtime dependencies in `package.json`.
- [ ] 2.2 Remove `SearchConfig` from `src/bun/config/index.ts`.
- [ ] 2.3 Add `PiEngineConfig.harness.web_search` config with `max_steps` (default 30) and optional `headless` flag.
- [ ] 2.4 Remove the `search:` block from `config/workspace.yaml.sample` and document the new browser-based search.
- [ ] 2.5 Add config validation tests for `harness.web_search.max_steps` and confirm `SearchConfig` is no longer in the type surface.

## 3. HTML sanitizer

- [ ] 3.1 Create `src/bun/engine/pi/tools/html-sanitizer.ts` with a `sanitizeHtml(html)` function that strips scripts, styles, head, metadata, comments, and collapses whitespace while preserving content tags and links.
- [ ] 3.2 Add a `htmlToMarkdown(html)` helper for page extraction.
- [ ] 3.3 Add `src/bun/test/pi/html-sanitizer.test.ts` covering HS-1 through HS-5.

## 4. Browser automation tools

- [ ] 4.1 Define a `BrowserSession` interface in `src/bun/engine/pi/tools/browser.ts` with `searchGoogle(query)`, `navigate(url)`, and `extractContent()`.
- [ ] 4.2 Implement a Playwright-backed `PlaywrightBrowserSession` and a production factory.
- [ ] 4.3 Implement `browser_search` tool that calls the injected browser session and returns sanitized HTML.
- [ ] 4.4 Implement `browser_navigate` tool that calls the injected browser session and returns the final URL.
- [ ] 4.5 Implement `browser_extract` tool that calls the injected browser session and returns markdown/text.

## 5. Web search parent tool

- [ ] 5.1 Implement `buildWebSearchTool` in `src/bun/engine/pi/tools/web.ts` that:
  - Accepts a text prompt.
  - Spawns a child session with only browser tools via the shared runner.
  - Appends a browser-agent system prompt suffix (concise, cite sources, prefer primary sources, stop when sufficient).
  - Enforces `max_steps` and asks for summary when exceeded.
  - Returns the child agent's final markdown response.
- [ ] 5.2 Remove `search_internet` from `buildWebTools`.

## 6. Update fetch_url

- [ ] 6.1 Reimplement `fetch_url` to use Playwright or a shared fetch helper.
- [ ] 6.2 Apply the same HTML sanitizer to fetched pages.
- [ ] 6.3 Add `src/bun/test/pi/web-tools.test.ts` covering FU-1 through FU-4.

## 7. Wire engine, tool factory, and tool index

- [ ] 7.1 Extend `AllToolsOptions` in `src/bun/engine/pi/tools/index.ts` with child-spawning fields.
- [ ] 7.2 Pass those fields into `buildWebTools`.
- [ ] 7.3 Extend `PiToolFactory.buildTools()` in `src/bun/engine/pi/tool-factory.ts` to accept child-spawning dependencies and forward them to `buildAllTools()`.
- [ ] 7.4 In `src/bun/engine/pi/engine.ts`, create a per-execution `delegateEmitRef`, pass it through `PiToolFactory.buildTools()`, and wire `delegateEmitRef.emit` to the queue returned by `startExecution()`.
- [ ] 7.5 Add `src/bun/test/pi/web-search-engine-wiring.test.ts` to verify dependency threading and event streaming (EW-1 through EW-3).

## 8. Tool display metadata

- [ ] 8.1 Add display cases in `src/bun/engine/pi/tools/display.ts` for `web_search`, `browser_search`, `browser_navigate`, and `browser_extract`.
- [ ] 8.2 Add unit tests for the new display cases.

## 9. Tests

- [ ] 9.1 Create `src/bun/test/pi/web-search.test.ts` with mock child session and mock browser session.
  - WS-1: child receives only browser tools.
  - WS-2: step limit enforced; exceeded limit returns summary prompt.
  - WS-3: returns child markdown with Sources section.
  - WS-4: child tool events forwarded as internal events under subagent bubble.
  - WS-5: abort signal cleans up child session.
  - WS-6: browser errors surfaced as `isError` results.
- [ ] 9.2 Create `src/bun/test/pi/browser-tools.test.ts` with a fake `BrowserSession`.
  - BT-1: `browser_search` returns sanitized HTML.
  - BT-2: `browser_navigate` tracks current URL.
  - BT-3: `browser_extract` returns markdown/text.
  - BT-4: browser session closed even when tool throws.
  - BT-5: search/navigation errors surfaced as `isError` results.
  - BT-6: extraction uses the last navigated URL.
- [ ] 9.3 Create `src/bun/test/pi/html-sanitizer.test.ts`.
  - HS-1: removes scripts and styles.
  - HS-2: removes head, metadata, and comments.
  - HS-3: preserves content tags and links.
  - HS-4: collapses whitespace and decodes entities.
  - HS-5: `htmlToMarkdown` produces readable markdown.
- [ ] 9.4 Create `src/bun/test/pi/web-tools.test.ts` for `fetch_url` fallback.
  - FU-1: returns sanitized text/markdown for HTML.
  - FU-2: respects timeout and reports timeout errors.
  - FU-3: reports HTTP errors as `isError` results.
  - FU-4: truncates large responses.
- [ ] 9.5 Ensure existing `src/bun/test/pi/delegate.test.ts` still passes after `child-runner.ts` extraction.
- [ ] 9.6 Add config validation tests for `harness.web_search.max_steps` and removal of `SearchConfig`.
- [ ] 9.7 Create `src/bun/test/pi/web-search-engine-wiring.test.ts`.
  - EW-1: child-spawning dependencies thread through `PiToolFactory.buildTools()`.
  - EW-2: `delegateEmitRef` events reach the execution queue.
  - EW-3: `web_search` is included only when the `web` tool group is active.
- [ ] 9.8 Add tool display tests for `web_search`, `browser_search`, `browser_navigate`, and `browser_extract`.

## 10. Verification

- [ ] 10.1 Run `bun install` to apply dependency changes.
- [ ] 10.2 Run `bun test src/bun --timeout 20000` and fix regressions.
- [ ] 10.3 Run `bun run typecheck` and fix type errors.
