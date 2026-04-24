## Context

The Claude engine dispatches slash commands by passing a raw `/command-name` string directly to the Claude SDK (e.g. `/opsx:propose my feature`). The SDK handles command resolution natively from `.claude/commands/`. Railyin does not perform any filesystem lookup for Claude commands.

The user-facing chat surfaces store messages with chip markup (`[/opsx:propose|/opsx:propose] my feature`) in the database but derive a clean engine-facing string (`/opsx:propose my feature`) via `extractChips()` before forwarding to the engine. This derivation happens in `tasks.sendMessage` and `chatSessions.sendMessage` handlers.

This pipeline has no integration-level test verifying that the string delivered to the engine is correct. The `MockExecutionEngine` echoes `"Mock response: ${params.prompt}"`, which makes it a built-in oracle — but no test exploits it for the slash-command path.

## Goals / Non-Goals

**Goals:**
- Add API integration tests (in `e2e/api/smoke.test.ts`) that prove `tasks.sendMessage` and `chatSessions.sendMessage` deliver the right `params.prompt` to the engine for slash chip inputs
- Cover both the `engineContent` fast path (UI sends extracted text) and the `extractChips` fallback (only `content` is sent)
- Add unit test for colon-separated command names (`/opsx:propose`) in `chat-chips.test.ts`
- Update specs for `slash-prompt-resolution` and `chat-regression-coverage`

**Non-Goals:**
- No production code changes — tests only
- Not testing live Claude SDK command resolution (that requires spawning a real Claude CLI process)
- Not testing command listing (`engine.listCommands`) — already covered in `list-commands.test.ts`

## Decisions

### Decision: Use MockExecutionEngine echo as the oracle

The smoke test server starts with `RAILYN_TEST_EXECUTION_ENGINE=mock`. `MockExecutionEngine.execute()` yields `"Mock response: ${params.prompt}"` as the assistant response. This is the cheapest way to assert what string the engine receives without any mocking framework — just read the assistant message content after the execution completes.

**Alternative considered**: Inject a custom mock adapter into `ClaudeEngine` via the existing `MockClaudeSdkAdapter` pattern used in `list-commands.test.ts`. Rejected because `smoke.test.ts` tests the full HTTP/RPC server, not individual engine classes — the mock engine is the right level.

### Decision: Test both engineContent path and extractChips fallback

The handler at `tasks.ts:299` is:
```typescript
const promptContent = params.engineContent ?? extractChips(params.content).humanText;
```

Two distinct tests are needed:
1. **Fast path**: send `{ content: "[/opsx:propose|/opsx:propose] my feature", engineContent: "/opsx:propose my feature" }` — mirrors what the UI sends
2. **Fallback path**: send `{ content: "[/opsx:propose|/opsx:propose] my feature" }` with no `engineContent` — proves `extractChips` is wired correctly server-side

Both should produce `"Mock response: /opsx:propose my feature"`.

### Decision: Add colon-separated unit test to chat-chips.test.ts

`chat-chips.test.ts` currently only tests hyphenated command names (`opsx-propose`). The `CHIP_PATTERN = /\[([#@/][^\]|]+)\|([^\]]+)\]/g` regex does handle colons (they're matched by `[^\]|]+`), but there's no test asserting this. Adding one creates a regression tripwire for any future CHIP_PATTERN change.

### Decision: Reuse existing smoke test server fixture

`e2e/api/smoke.test.ts` already has a `describe("tasks")` suite with a running server, a seeded task, and a `waitFor` helper. New slash command tests extend this existing suite — no new server setup needed.

## Risks / Trade-offs

- **Risk**: Smoke tests are slow (real server spawn). → Mitigation: tests are additive inside existing describe blocks; no new server is spawned.
- **Risk**: The `waitFor` helper may time out if the mock engine is slow. → Mitigation: MockExecutionEngine has 10ms delay per chunk; existing tests already rely on this successfully.
- **Trade-off**: Testing only the `"Mock response: …"` echo does not catch bugs in how the Claude SDK itself interprets the string. → Accepted: SDK-level testing requires a real Claude CLI binary and is out of scope.
