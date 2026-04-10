## Context

Sub-agents spawned via `spawn_agent` run as in-memory child executions that call `retryTurn(provider, liveMessages, { tools: toolDefs })`. Each child starts with a single `user` message (the instructions string) and a set of tool definitions. There is no system message — just `[{ role: "user", content: instructions }]`.

When multiple children run via `Promise.all`, they each send independent API requests. On Anthropic, each request transmits the full tool definitions as uncached input tokens. Since cached input tokens don't count toward ITPM rate limits, warming a shared cache prefix on the first child's call would let subsequent children read from cache at zero rate limit cost.

The parent execution already uses a shared `provider` instance (singleton registry keyed by `qualifiedModel`), so all children share `cooldownUntil`. But there is no mechanism to share a prompt prefix.

## Goals / Non-Goals

**Goals:**
- Sub-agent API calls share a byte-identical prefix (system prompt + tool definitions) so Anthropic's prompt cache can serve cache hits across concurrent children
- The first child's call warms the cache; subsequent children read from it at 10% input cost and zero ITPM impact
- Tool definition ordering is deterministic across all children to ensure prefix stability

**Non-Goals:**
- Sharing parent conversation history with children (children start fresh by design)
- Supporting non-Anthropic providers with caching (silently ignored)
- Changing the `Promise.all` parallel execution model

## Decisions

**1. Add a system message to sub-agent calls**

Currently `runSubExecution` starts with `liveMessages = [{ role: "user", content: instructions }]`. We'll prepend a system message containing a brief context line ("You are a sub-agent...") so that the system block can carry `cache_control`. This system message is stable across all children.

Rationale: Anthropic's cache hierarchy is `tools → system → messages`. Tool definitions are passed in the `tools` API parameter, which is cached separately. The system message is the next natural cache target. A stable system prefix maximizes cache hits.

**2. Sort tool definitions by name**

`resolveToolsForColumn(tools)` returns tool definitions in registration order, which is already deterministic in practice. But to guarantee byte-identical prefixes, we'll sort the resolved `toolDefs` array by `name` before passing to `retryTurn`. Sorting happens once per `runSubExecution` call — negligible cost.

**3. Depend on prompt-caching change for wire format**

The `prompt-caching` change adds `cache_control` support to `adaptMessages()` in `anthropic.ts`. This change depends on that — it adds the system message and sorted tools, but the actual `cache_control` wire encoding is handled by the prompt-caching infrastructure.

If the prompt-caching change uses automatic caching (`cache_control` at the request top level), then this change only needs to ensure prefix stability. If it uses explicit block-level breakpoints, then the system message must carry `cache_control`.

**4. No staggering or serialization of children**

Children still launch via `Promise.all`. The first child to reach the API warms the cache entry. Due to network latency, other children typically arrive milliseconds later and benefit from the warm cache. No artificial delay is needed.

## Risks / Trade-offs

- **Minimum cache size**: Anthropic requires at least 1024–4096 tokens (model-dependent) for caching. Sub-agents with only 3-4 tool definitions may fall below the threshold. Mitigation: if the system message + tools are below threshold, caching is silently skipped by the API — no error, just no benefit.
- **Cache TTL**: Default 5-minute cache expires between task executions. For within-execution sub-agents (which run for seconds to minutes), 5 minutes is sufficient. The `extended-cache-ttl` change could extend this if needed.
- **Dependency on prompt-caching change**: This change cannot be implemented until `prompt-caching` is done. No workaround needed — the effort is small and can wait.
