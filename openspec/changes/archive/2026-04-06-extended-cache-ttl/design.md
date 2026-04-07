## Context

Anthropic prompt caching supports two TTL values: 5-minute (default, 1.25× write cost) and 1-hour (2× write cost). Both provide reads at 10% of base token price. The `prompt-caching` change introduces `cache_control: { type: "ephemeral" }` on system blocks and conversation breakpoints. This change extends it with an optional `ttl: "1h"` field.

The 1h TTL is most valuable for:
- Multi-round agent executions that span >5 minutes (tool loops, sub-agent chains)
- Tasks that pause for user input and resume (the cache survives the wait)
- Workflows where the same large system prompt is reused across sequential executions

## Goals / Non-Goals

**Goals:**
- Allow users to opt into 1-hour cache TTL via workspace config
- Default remains 5-minute (cheaper writes, sufficient for most single-round calls)

**Non-Goals:**
- Per-request or per-block TTL selection (one TTL for the whole workspace)
- Mixing 5-minute and 1-hour TTLs within a single request (Anthropic supports this but adds complexity)
- Automatic TTL selection based on execution duration

## Decisions

**1. Config-level toggle, not automatic**

Users explicitly choose `"1h"` when they know their workflow benefits from it. Automatic selection would require predicting execution duration, which is unreliable.

**2. Single TTL per workspace**

All `cache_control` blocks in a request use the same TTL. Mixing TTLs requires strict ordering (1h before 5m) and adds complexity for marginal benefit. One TTL keeps the implementation simple.

## Risks / Trade-offs

- **2× write cost**: 1-hour cache writes cost double. For short conversations that complete in <5 minutes, this is wasted. Mitigation: default is `"5m"`, user opts in only when needed.
- **Anthropic-only**: Other providers silently ignore `cache_control`. Not a risk, just a limitation.
