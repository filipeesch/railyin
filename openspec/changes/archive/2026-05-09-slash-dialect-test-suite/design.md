## Context

The `slash-command-dialect` change introduces new classes and refactors existing free functions into a class hierarchy. Test coverage must be established alongside implementation to prevent silent regressions in the existing Copilot slash-prompt behavior while verifying the new Pi dialect integration end-to-end.

This design uses **dependency injection** throughout: dialect implementations are injected via constructors, enabling `SpyDialect` mocks in engine tests without filesystem setup. The `SpyDialect` pattern is the central enabler for fast, focused engine tests.

## Goals / Non-Goals

**Goals:**
- All existing `slash-prompt.test.ts` scenarios preserved, migrated to `CopilotDialect` class API
- New dialect classes (`ClaudeDialect`, `NullDialect`, `SlashCommandDialectRegistry`) have dedicated unit test files
- Pi engine dialect integration tested via `SpyDialect` injection (no filesystem needed for engine behavior tests)
- `TransitionExecutor` test updated to reflect dead-code removal (`displayText` = raw prompt)
- `copilot-rpc-scenarios.test.ts` updated to assert XML-wrapped content sent to SDK

**Non-Goals:**
- Testing the Claude SDK's `listCommands()` — this is an adapter concern, not a dialect concern
- Playwright tests for slash resolution (engine behavior; not UI behavior)
- Mutation testing targets for this change

## Decisions

### D1: `SpyDialect` as the primary mock for engine integration tests

```ts
class SpyDialect implements SlashCommandDialect {
  readonly calls: string[] = [];
  constructor(
    private readonly commands: CommandInfo[] = [],
    private readonly resolvedContent = "RESOLVED",
  ) {}
  listCommands(): CommandInfo[] { return this.commands; }
  async resolvePrompt(value: string): Promise<ResolvedPrompt> {
    this.calls.push(value);
    return value.startsWith("/")
      ? { content: `<command name="${value.slice(1)}">${this.resolvedContent}</command>`, wasSlash: true, sourceCommand: value.slice(1) }
      : { content: value, wasSlash: false };
  }
}
```

`SpyDialect` lives in a test-only `helpers.ts` or inline per test file. It enables Pi engine tests to verify the *calling contract* (was `resolvePrompt` called? with what?) without touching the filesystem. Filesystem tests belong only in the dialect's own unit tests.

### D2: `copilot-dialect.test.ts` replaces `slash-prompt.test.ts` entirely

All 20+ existing scenarios from `slash-prompt.test.ts` are migrated as-is, with two mechanical changes:
1. Import path changes from `copilot-prompt-resolver` to `copilot-dialect`
2. String assertions on resolved content change to assert `ResolvedPrompt.content` with XML wrapper

The XML wrapping is new behavior — every assertion that previously expected bare file content now expects `<command name="…" args="…">\n…\n</command>`. This is intentional: XML wrapping is a first-class contract, not an implementation detail.

### D3: `claude-dialect.test.ts` covers the colon-path mapping explicitly

`ClaudeDialect.resolvePrompt()` must reverse the colon-separator convention: `/opsx:apply` → `opsx/apply.md`. This is a new code path with no existing test coverage. Dedicated test cases verify:
- Root-level: `/my-cmd` → `my-cmd.md`
- One level: `/opsx:apply` → `opsx/apply.md`
- Two levels: `/opsx:apply:v2` → `opsx/apply/v2.md`
- Preservation in XML tag: `name="opsx:apply"` (colon preserved in tag attribute)

### D4: `transition-executor.test.ts` simplification

The test `"stores enriched transition metadata"` currently:
- Writes `.github/prompts/opsx-propose.prompt.md` to `gitDir`
- Uses Copilot engine
- Asserts `displayText: "Expanded instructions for transition card"` (expanded file body)

After the change, this test:
- Does **not** need the prompt file (resolution no longer happens in `TransitionExecutor`)
- Asserts `displayText: "/opsx-propose transition card"` (raw prompt = sourceText)
- No dialect injection into `makeTestRegistry` needed

This is a simplification, not an addition.

### D5: `ClaudeDialect` frontmatter asymmetry test

`ClaudeDialect` reads frontmatter `description:` for `listCommands()` but does NOT strip frontmatter during `resolvePrompt()`. This asymmetry must be tested explicitly:

```
CLD-FM-ASYM-1: listCommands() returns description from frontmatter
CLD-FM-ASYM-2: resolvePrompt() returns body WITH frontmatter block intact
```

## Risks / Trade-offs

- **[Risk] `slash-prompt.test.ts` migration gaps** — if any scenario is missed, silent regression in Copilot behavior. Mitigation: migrate test-by-test with a checklist, not bulk rewrite.
- **[Trade-off] Two code paths for Claude commands** — `ClaudeEngine` uses SDK, `ClaudeDialect` uses filesystem. They should produce the same `description` values but via different mechanisms. No parity test is written since we can't mock the SDK's internal behavior reliably; this is accepted as a known divergence.
