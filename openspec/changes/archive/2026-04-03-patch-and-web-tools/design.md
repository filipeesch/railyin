## Context

The workflow engine dispatches tool calls from an AI model through `executeTool()` in `tools.ts`. Tools are grouped in `TOOL_GROUPS` and referenced by group names in workflow YAML. Currently:

- `replace_in_file` covers only the "swap old string for new" pattern; prepend, append, and anchor-relative inserts require either `write_file` (full rewrite) or `run_command` (blocked for writes).
- `read_file` reads entire files — costly for large source files where the model only needs a specific section it already located via `search_text`.
- `search_text` returns matching lines only, so the model typically follows with a `read_file` to understand surrounding context.
- No web access exists; models must include documentation from training knowledge alone.
- `ask_user` is inconsistent with first-person product voice (elsewhere the product speaks as "me" / "I").
- Web search config has no home in `workspace.yaml`; the `WorkspaceYaml` type and default template need a `search` section.

## Goals / Non-Goals

**Goals:**
- Unify all in-place edit patterns into one `patch_file` tool (fewer definitions = fewer tokens always in context)
- Enable partial file reads so models navigate large files efficiently
- Let `search_text` return surrounding context lines, reducing follow-up `read_file` calls
- Provide `fetch_url` for URL content retrieval (always available, SSRF-safe)
- Provide `search_internet` gated by workspace config (graceful no-op when unconfigured)
- Rename `ask_user` → `ask_me` consistently across all files
- Add `web` tool group to `TOOL_GROUPS` and `delivery.yaml`

**Non-Goals:**
- Supporting Brave Search in this iteration (Tavily only for `search_internet`)
- HTML rendering or JavaScript execution in `fetch_url`
- Caching fetch/search results
- Per-column web tool permission granularity (group-level is sufficient)

## Decisions

### D1: `patch_file` supersedes `replace_in_file`

`patch_file` accepts `position: "start" | "end" | "before" | "after" | "replace"` with an optional `anchor`. The `"replace"` position is semantically identical to `replace_in_file` (`anchor` = old text, `content` = new text) with the same "must appear exactly once" ambiguity guard. Anchor-based positions (`before`, `after`, `replace`) all enforce uniqueness. `start` and `end` need no anchor.

**Alternative considered:** Keep `replace_in_file` and add separate `append_to_file` / `prepend_to_file`. Rejected — more tool definitions = more tokens consumed in every system message, and the unified schema is learnable.

### D2: `read_file` partial reads via `start_line` / `end_line`

Both params are optional integers (1-based). If omitted, full file is returned (current behaviour). The model learns line numbers from `search_text` output (`file:linenum:content`), so it can immediately target the relevant section without a separate discovery step.

**Alternative considered:** `offset` + `length` in bytes. Rejected — line numbers from grep output are immediately usable; byte offsets require mental arithmetic.

### D3: `search_text` `context_lines` param

Maps directly to `grep -C N`. Default 0 (current behaviour). Typical value the model will use: 2–5 lines. This often eliminates a follow-up `read_file` entirely for small targeted edits.

### D4: `fetch_url` — Bun native fetch + SSRF block-list

Bun has built-in `fetch()`; no new dependency. After fetching, strip HTML tags with a simple regex (no external parser needed for v1 — strip `<[^>]+>`, collapse whitespace). SSRF protection: resolve hostname, reject if it resolves to `127.x`, `10.x`, `172.16–31.x`, `192.168.x`, or `::1`. Cap response at 100KB of text.

**Alternative considered:** Use `lynx --dump` or `pandoc` for better HTML-to-text conversion. Rejected — external binary dependency; simple tag stripping is sufficient for documentation pages.

### D5: `search_internet` — Tavily API only, gated by config

`workspace.yaml` gains an optional `search` block:
```yaml
search:
  engine: tavily   # only supported value in v1
  api_key: ""
```

`WorkspaceYaml` interface gains `search?: { engine: string; api_key: string }`. At runtime, `search_internet` reads loaded config: if `search` is absent or `api_key` is empty, returns `"Error: search not configured — add search.engine and search.api_key to workspace.yaml"`. Tavily endpoint: `POST https://api.tavily.com/search` with `{ query, max_results: 5 }`. Response is mapped to a readable list of `title + url + snippet` lines.

**Alternative considered:** DuckDuckGo Instant Answer (no key). Rejected — only returns Wikipedia summaries, useless for code/library research.

### D6: `ask_user` → `ask_me` rename

Pure rename — no behaviour change. Engine interception checks `name === "ask_me"`. System message updated. All references updated atomically. **BREAKING** for any custom workflow YAML that lists `ask_user` explicitly (the `interactions` group is the recommended way to reference it, so impact is minimal).

### D7: `web` group added to `TOOL_GROUPS`

```typescript
["web", ["fetch_url", "search_internet"]]
```

Added to `delivery.yaml` `in_progress` column. `search_internet` self-disables when unconfigured, so adding `web` to the group never breaks setups without a search API key.

## Risks / Trade-offs

- **SSRF via DNS rebinding** → Mitigation: resolve hostname before fetch and check the resolved IP; not just the hostname string.
- **`patch_file` anchor ambiguity with `"before"`/`"after"`** → Same "must appear exactly once" guard as `replace_in_file`; model gets a clear error with instruction to add more context.
- **HTML stripping quality** → Simple regex won't handle `<script>` content gracefully. Mitigation: strip `<script>...</script>` blocks before tag stripping, cap at 100KB.
- **Tavily rate limits on free tier** → 1000 req/month; graceful API error returned as tool error string — agent continues without crashing.
- **Breaking rename of `ask_user`** → Any user who referenced `ask_user` by name (not group) in a custom column YAML breaks. Mitigation: clear release note; the `interactions` group abstraction is the idiomatic path.

## Migration Plan

1. Update `tools.ts` (tool definitions + executeTool + TOOL_GROUPS)
2. Update `config/index.ts` (type + default template)
3. Update `engine.ts` (interception rename + system message)
4. Update `delivery.yaml` and `workspace.yaml`
5. Update all tests (rename ask_user, replace replace_in_file tests with patch_file)
6. Run full test suite — expect 65+ passing tests

No database schema change. No rollback complexity — all changes are in application code and config files.
