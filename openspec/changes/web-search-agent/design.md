## Context

The Pi engine has child-session infrastructure originally used by the `delegate` tool (`src/bun/engine/pi/child-session.ts`, `src/bun/engine/pi/tools/delegate.ts`). However, `delegate` is currently disabled on `main` and the previous `delegateEmitRef` plumbing was removed in the Pi engine refactor. The engine now builds tools via `PiToolFactory.buildTools()` rather than inline in `engine.ts`.

This change extracts the child-session runner pattern from `delegate.ts` and uses it for `web_search` only. The `delegate` tool itself remains disabled.

The codebase also has web tools (`src/bun/engine/pi/tools/web.ts`) that currently call Tavily for search and use raw `fetch` for page retrieval. This change replaces them with browser-based automation.

## Goals / Non-Goals

**Goals:**
- Give the parent Pi agent a `web_search` tool that performs real browser-based research.
- Spawn a specialized child agent with only browser tools (`browser_search`, `browser_navigate`, `browser_extract`).
- Return a concise markdown summary with a `Sources` section listing visited URLs.
- Remove Tavily dependency and config.
- Reuse and extract the child-session runner pattern from `delegate.ts`.
- Stream child agent events to the UI as nested subagent bubbles.

**Non-Goals:**
- Full browser interaction (clicking, forms, scrolling) in v1.
- Separate model or credentials for the child agent.
- File-system access for the child agent.
- Attachment support in the `web_search` prompt.

## Decisions

### 1. Specialized Pi child agent
The `web_search` tool spawns a Pi child session pre-loaded with browser tools. This reuses existing infrastructure, respects the provider concurrency limiter, and gives the child an LLM to decide which results to follow.

### 2. Playwright as the browser library
Playwright is already used for UI tests. Moving it to runtime dependencies lets the Bun backend launch headless browsers. A fresh browser context is created per `web_search` call and closed in `finally`.

### 3. Tool set for the child agent
The child receives only:
- `browser_search(query)` — search Google and return sanitized result HTML.
- `browser_navigate(url)` — navigate the browser to a URL.
- `browser_extract()` — extract sanitized text/markdown from the current page.

No file-system, delegate, or board tools are provided.

### 4. HTML sanitization
`browser_search` and `browser_extract` return cleaned HTML/text with scripts, styles, head, metadata, and comments removed. Content tags and links are preserved so the child LLM can parse results.

### 5. Step limit
`harness.web_search.max_steps` configures a hard limit (default 30). The child prompt instructs the agent to aim for ~20 steps and summarize. When the hard limit is reached, the runner returns a result asking the agent to summarize findings.

### 6. Shared child-session runner
Extract a `child-runner.ts` module from `delegate.ts` that handles:
- Subagent start/result bubble events
- Child event forwarding (`tool_start`/`tool_result` as internal events)
- Raw-model observability forwarding
- Tool loop detection
- Disposal and unsubscribe

`web_search` will use this runner. `delegate` remains disabled, but the runner is structured so it can be reused if delegate is re-enabled later.

### 7. Parent engine wiring
`engine.ts` creates a per-execution `delegateEmitRef` and passes it into `PiToolFactory.buildTools()`. `PiToolFactory` forwards the ref (plus other child-spawning dependencies) into `buildAllTools()`. The actual wiring to the event queue happens after `startExecution()` returns:

```
engine.ts
  └── creates delegateEmitRef
  └── PiToolFactory.buildTools({ ..., delegateEmitRef, ... })
        └── buildAllTools({ ..., delegateEmitRef, ... })
              └── buildWebTools({ ..., delegateEmitRef, ... })
  └── startExecution() → queue
  └── delegateEmitRef.emit = (event) => queue.push(event)
```

Child-spawning dependencies to thread through:
- `delegateEmitRef`
- `limiterRegistry`
- `parentModel`
- `parentSystemPrompt`
- `parentConversationId`
- `parentCwd`
- `engineConfig`
- `onRawModelMessage`

### 8. Testability via DI
To keep tests fast and deterministic, the Playwright-backed `BrowserSession` is hidden behind an injectable factory interface. Production code passes the real Playwright factory; tests inject a scripted fake that returns canned HTML and page state. This avoids launching browsers in unit tests and lets us exercise `web_search` end-to-end with a mock child session and mock browser.

## Risks / Trade-offs

- [Risk] Playwright browser downloads increase install size and startup time → Accepted; browser automation requires it.
- [Risk] Google search result pages change layout and break extraction → Mitigated by returning cleaned HTML and letting the LLM parse links; extraction selectors can be adjusted.
- [Risk] Fresh browser per call is slower than API search → Accepted for v1 in exchange for realism and no API key.
- [Risk] Adding `delegateEmitRef` infrastructure touches the execution hot path → Keep the ref optional so tools that don't spawn children are unaffected.
- [Risk] The `delegate` tool is currently disabled; we are intentionally not re-enabling it, so the shared runner is only exercised by `web_search` until delegate is restored.

## Test Strategy

Tests are part of this change and focus on behavior, not browser binaries:

- **Unit tests for `web_search`** in `src/bun/test/pi/web-search.test.ts`:
  - Child session receives only browser tools (no file-system or delegate tools).
  - Step limit is enforced; when exceeded the runner asks the agent to summarize.
  - Markdown output with `Sources` section is returned to the parent.
  - Child tool events are forwarded as internal events under the subagent bubble.
  - Abort signal is respected and cleans up the child session.
  - Browser errors are surfaced as `isError` tool results.

- **Unit tests for browser tools** in `src/bun/test/pi/browser-tools.test.ts`:
  - `browser_search` returns sanitized HTML from the injected fake browser.
  - `browser_navigate` tracks the current URL.
  - `browser_extract` returns markdown/text from the current page.
  - Browser session is closed even when a tool throws.
  - Search/navigation errors are surfaced as `isError` tool results.
  - Extraction reflects the last navigated URL.

- **Unit tests for HTML sanitizer** in `src/bun/test/pi/html-sanitizer.test.ts`:
  - Scripts, styles, head, metadata, and comments are removed.
  - Content tags and links are preserved.
  - Whitespace is collapsed and HTML entities are decoded.
  - `htmlToMarkdown` produces readable markdown.

- **Unit tests for `fetch_url` fallback** in `src/bun/test/pi/web-tools.test.ts`:
  - Returns sanitized text/markdown for HTML pages.
  - Respects timeout and reports timeout errors.
  - Reports HTTP errors as `isError` results.
  - Truncates large responses.

- **Refactor-preservation tests for `delegate`** in `src/bun/test/pi/delegate.test.ts`:
  - Existing delegate tests continue to pass after extracting `child-runner.ts`.
  - Child event forwarding, loop detection, and subagent bubbles remain intact.

- **Config / validation tests**:
  - `validatePiEngineConfig` rejects invalid `harness.web_search.max_steps` values.
  - `SearchConfig` is removed from the type surface.

- **Engine wiring tests** in `src/bun/test/pi/web-search-engine-wiring.test.ts`:
  - `PiToolFactory.buildTools()` threads child-spawning dependencies into `buildWebTools`.
  - Events emitted via `delegateEmitRef` reach the execution queue.
  - `web_search` is included only when the `web` tool group is active.

- **Tool display tests**:
  - `buildPiToolDisplay` returns correct labels/subjects for the new tools.

- **Integration / Playwright UI tests** (optional follow-up):
  - A UI spec can seed persisted messages with `parent_tool_call_id: webSearchCallId` to verify nested rendering, similar to `delegate-rendering.spec.ts`.
  - No real browser is required for the initial test suite.
