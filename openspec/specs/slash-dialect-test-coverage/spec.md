# Spec: slash-dialect-test-coverage

## Purpose

Test coverage specification for the slash command dialect system. Defines unit and integration test requirements for `SlashCommandDialectRegistry`, `NullDialect`, `CopilotDialect`, `ClaudeDialect`, Pi engine dialect integration, engine-registry dialect wiring, and related test simplifications/migrations.

## Requirements

### Requirement: SlashCommandDialectRegistry unit tests

**File:** `src/bun/test/slash-command-dialect-registry.test.ts`

All cases use in-memory only — no filesystem, no DB.

| ID | Scenario | Assert |
|----|----------|--------|
| SCD-REG-1 | Registered factory is called on `create()` | factory invocation count = 1 |
| SCD-REG-2 | `register()` is chainable (returns `this`) | fluent chain compiles and runs |
| SCD-REG-3 | `create()` with unknown name throws with dialect name in message | error message contains the unknown name |
| SCD-REG-4 | `createDefaultDialectRegistry()` can create `"copilot"` | returns `CopilotDialect` instance |
| SCD-REG-5 | `createDefaultDialectRegistry()` can create `"claude"` | returns `ClaudeDialect` instance |
| SCD-REG-6 | `createDefaultDialectRegistry()` can create `"none"` | returns `NullDialect` instance |
| SCD-REG-7 | Each `create()` call returns a new instance | two calls return distinct objects |
| SCD-REG-8 | Registering same name twice overwrites (last write wins) | second factory used |

---

### Requirement: NullDialect unit tests

**File:** `src/bun/test/null-dialect.test.ts`

| ID | Scenario | Assert |
|----|----------|--------|
| ND-1 | `listCommands()` returns `[]` | empty array |
| ND-2 | `resolvePrompt()` on plain text returns content unchanged, `wasSlash: false` | content === input, wasSlash false |
| ND-3 | `resolvePrompt()` on slash value returns content unchanged, `wasSlash: false` | even slash values pass through |

---

### Requirement: CopilotDialect unit tests

**File:** `src/bun/test/copilot-dialect.test.ts`

Replaces `slash-prompt.test.ts` (deleted). Uses temp filesystem dirs via `beforeEach`/`afterEach`.

**Listing (migrated from `list-commands.test.ts`):**

| ID | Scenario | Assert |
|----|----------|--------|
| CD-LIST-1 | `listCommands()` on non-existent dir returns `[]` | empty array |
| CD-LIST-2 | `listCommands()` returns `.prompt.md` files as `CommandInfo` | name = stem, no extension |
| CD-LIST-3 | Deduplicates across worktree / projectRoot / personal scopes (worktree wins) | one entry per name |
| CD-LIST-4 | Reads `description:` from YAML frontmatter | `CommandInfo.description` populated |
| CD-LIST-5 | Ignores non-`.prompt.md` files | `.md`, `.txt`, `.js` not returned |

**Resolution (migrated from `slash-prompt.test.ts`, all 20+ scenarios):**

| ID | Scenario | Assert |
|----|----------|--------|
| CD-RES-1..N | All existing `slash-prompt.test.ts` scenarios | same behavior, new `ResolvedPrompt` shape |

**XML wrapping (new):**

| ID | Scenario | Assert |
|----|----------|--------|
| CD-XML-1 | Resolved slash ref has `wasSlash: true` | flag set |
| CD-XML-2 | `content` is XML-wrapped: `<command name="…" args="…">\n…\n</command>` | wrapper present |
| CD-XML-3 | `sourceCommand` = stem without leading slash | `"opsx-propose"` |
| CD-XML-4 | `sourceArgs` = trailing text after command name | `"add-dark-mode"` |
| CD-XML-5 | Non-slash values have `wasSlash: false`, no XML wrapping | content === input |
| CD-XML-6 | Frontmatter stripped before body appears inside XML tag | `---` block not in wrapped content |
| CD-XML-7 | `$input` substituted inside XML tag | substitution happens before wrapping |

---

### Requirement: ClaudeDialect unit tests

**File:** `src/bun/test/claude-dialect.test.ts`

Uses temp filesystem dirs. Migrates `collectClaudeCommands` cases from `list-commands.test.ts`.

**Listing:**

| ID | Scenario | Assert |
|----|----------|--------|
| CLD-LIST-1 | Empty dir returns `[]` | empty array |
| CLD-LIST-2 | Root-level `.md` file → name with no prefix | `"my-cmd"` |
| CLD-LIST-3 | Subdirectory file → colon-prefixed name | `commands/opsx/apply.md` → `"opsx:apply"` |
| CLD-LIST-4 | Two-level subdirectory → double colon | `commands/opsx/apply/v2.md` → `"opsx:apply:v2"` |
| CLD-LIST-5 | Deduplicates across scopes | worktree entry wins |
| CLD-LIST-6 | Reads `description:` from frontmatter | `CommandInfo.description` populated |
| CLD-LIST-7 | Ignores non-`.md` files | `.txt`, `.js` not returned |

**Resolution:**

| ID | Scenario | Assert |
|----|----------|--------|
| CLD-RES-1 | Root-level `/my-cmd` resolves `my-cmd.md` | content returned |
| CLD-RES-2 | `/opsx:apply` resolves `opsx/apply.md` (colon → path separator) | correct file loaded |
| CLD-RES-3 | Two-level `/opsx:apply:v2` resolves `opsx/apply/v2.md` | correct file loaded |
| CLD-RES-4 | `wasSlash: true`, content is XML-wrapped | same shape as CopilotDialect |
| CLD-RES-5 | Colon preserved in XML `name` attribute | `name="opsx:apply"` |
| CLD-RES-6 | `$input` substituted in body | `$input` → trailing args |
| CLD-RES-7 | projectRoot takes priority over worktree | projectRoot file returned |
| CLD-RES-8 | `~/.claude/commands/` is last fallback | personal scope checked last |
| CLD-RES-9 | Non-slash values pass through (`wasSlash: false`) | passthrough |
| CLD-RES-10 | File not found throws with descriptive message | error contains command name |
| CLD-FM-1 | `listCommands()` returns `description` from frontmatter | populated |
| CLD-FM-2 | `resolvePrompt()` returns body WITH frontmatter block intact (not stripped) | `---` present in content |

---

### Requirement: Pi engine dialect integration tests (SpyDialect)

**File:** `src/bun/test/pi-harness.test.ts` (extended)

Uses `SpyDialect` (inline helper implementing `SlashCommandDialect`) — no filesystem required.

| ID | Scenario | Assert |
|----|----------|--------|
| PI-DI-1 | `PiEngine.listCommands()` delegates to `dialect.listCommands()` | spy receives call, returns spy's result |
| PI-DI-2 | `PiEngine.execute()` calls `dialect.resolvePrompt()` before `session.prompt()` | spy records the raw value; session receives resolved content |
| PI-DI-3 | `NullDialect` (default) passes prompt through unchanged | `session.prompt()` receives raw `/cmd` |
| PI-DI-4 | Constructor without explicit dialect defaults to `NullDialect` behavior | backward compat preserved |

---

### Requirement: engine-registry dialect wiring tests

**File:** `src/bun/test/engine-registry.test.ts` (extended)

| ID | Scenario | Assert |
|----|----------|--------|
| ER-DI-1 | Copilot engine always wired with `CopilotDialect` | `engine instanceof CopilotEngine` → `CopilotDialect` |
| ER-DI-2 | Claude engine always wired with `NullDialect` | `NullDialect` returned |
| ER-DI-3 | Pi engine with `dialect: copilot` config wired with `CopilotDialect` | `CopilotDialect` returned |
| ER-DI-4 | Pi engine with no `dialect` config defaults to `NullDialect` | `NullDialect` returned |

> Note: these tests verify wiring at construction time, not runtime behavior. If `getDialectForEngine()` is not exposed (per design D4), tests verify via injected engine behavior instead.

---

### Requirement: TransitionExecutor test simplification

**File:** `src/bun/test/transition-executor.test.ts` (updated)

| ID | Change | What to assert |
|----|--------|----------------|
| TE-SIMP-1 | Remove `.github/prompts/` file setup | test no longer needs filesystem |
| TE-SIMP-2 | Update `displayText` assertion | `displayText === "/opsx-propose transition card"` (raw prompt) |
| TE-SIMP-3 | No dialect injection into `makeTestRegistry` | helper remains unchanged |

---

### Requirement: CopilotEngine XML wrapping integration test

**File:** `src/bun/test/copilot-rpc-scenarios.test.ts` (updated)

| ID | Change | What to assert |
|----|--------|----------------|
| COP-XML-1 | Update `"resolves slash command prompt"` scenario | `session.prompts` = XML-wrapped content: `<command name="opsx-propose" args="add-dark-mode">\nResolved body: add-dark-mode\n</command>` |

---

### Requirement: list-commands.test.ts migration cleanup

**File:** `src/bun/test/list-commands.test.ts` (updated or deleted)

- `collectCopilotCommands` test cases move to `copilot-dialect.test.ts`
- `collectClaudeCommands` test cases move to `claude-dialect.test.ts`
- If no remaining cases, file is deleted; otherwise retain only what wasn't migrated
