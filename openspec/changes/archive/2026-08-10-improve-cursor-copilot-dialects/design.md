## Context

The Pi engine is the main target engine for this change. It currently supports dialect-based slash command and skill resolution via `PiDialectResolver`, but does not scan project instruction files from `.github/instructions/` (Copilot convention) or `.cursor/rules/` (Cursor convention). These instruction files contain project-specific guidelines that should be injected into the system prompt.

The Copilot engine resolves slash commands and lists commands from `.github/prompts/`, but does not scan `.github/instructions/` at the monorepo project root. The Cursor engine has a bug where `getSkillPaths()` is called without `projectPath`, causing project-level skills to be silently ignored in monorepo setups.

The Cursor SDK auto-loads `.cursor/rules/*.mdc` from the working directory via `settingSources: ["project"]` — no supplement needed. The Copilot SDK does NOT scan `.github/instructions/` — explicit scanning is required.

**Current architecture:**
- `SlashCommandDialect` interface defines `listCommands()`, `resolvePrompt()`, `getSkillPaths()`
- `PiDialectResolver` wraps a dialect and adds DB-based project path resolution
- Dialects are created via `createDefaultDialectRegistry()` (copilot, cursor, claude, none)
- System prompt is constructed from `[taskBlock, systemInstructions]` in each engine

**Constraints:**
- Minimal interface change to `SlashCommandDialect`: add `getDialectName()` so the Pi engine can resolve conventions without `constructor.name` inference (revised via decision_request)
- `cwd` is ALWAYS the projectPath (monorepo root); `workingDirectory` is the git worktree root
- Parameter naming kept as `(worktreePath, projectPath?)` for consistency
- Dialect-agnostic scanner with convention mapping layer

## Goals / Non-Goals

**Goals:**
- Pi engine scans instruction files based on configured dialect and injects them into the system prompt
- Copilot engine resolves projectPath from DB and scans `.github/instructions/` at both project root and worktree
- Cursor engine fixes getSkillPaths() bug to pass projectPath for project-level skill loading
- DRY scanning logic via standalone utility module reusable across all engines
- Structured JSON logging when instruction files are loaded
- Frontmatter parsing with autoApply support (full content vs frontmatter only)

**Non-Goals:**
- No changes to `SlashCommandDialect` interface
- No changes to existing dialect implementations (CopilotDialect, CursorDialect, etc.)
- No size limits for autoApply files
- No changes to Cursor SDK's native `.cursor/rules/` loading
- No changes to Copilot SDK's native instruction loading
- No changes to Claude/OpenCode engines

## Decisions

### Decision: Standalone instruction-scanner utility module
**Why:** DRY principle — the scanning logic is identical across engines. A standalone module in `engine/dialects/` provides a single source of truth, is reusable and testable, and keeps the scanning logic separate from engine-specific concerns.

**Alternatives considered:**
- Engine-embedded scanning: Would duplicate logic across 3 engines, harder to test, more maintenance burden
- Dialect interface method: Would change the interface, violating the "no interface changes" constraint

### Decision: Dialect-agnostic scanner with convention mapping
**Why:** The scanner is a generic utility that takes directory paths and file patterns as input, scans directories, parses frontmatter, and returns Instruction[]. A separate mapping layer determines which directories to scan based on the dialect. This follows single responsibility principle and makes the scanner reusable for any convention.

**Alternatives considered:**
- Dialect-aware scanner: Would have knowledge about conventions, violating SRP, harder to test, less flexible for custom conventions

### Decision: Add getInstructions() to PiDialectResolver
**Why:** PiDialectResolver already handles dialect-specific operations (resolvePrompt, getSkillPaths, listCommands). Adding getInstructions() keeps all dialect-related logic in one place. The resolver knows the dialect type and can delegate to the instruction scanner with appropriate paths.

**Alternatives considered:**
- Separate InstructionResolver service: Would add another service to wire up, Pi engine would need to manage two resolvers, more complexity

### Decision: Copilot engine uses the same utility module
**Why:** DRY principle — the scanning logic is identical. The utility module provides a single source of truth. Each engine just calls the scanner with appropriate paths and formats the results for its own system prompt injection mechanism.

**Alternatives considered:**
- Copilot engine inline implementation: Would duplicate logic, harder to maintain consistency, more testing overhead

### Decision: Scan based on dialect config
**Why:** Pi engine scans based on the `dialect` config: `copilot` → `.github/instructions/`, `cursor` → `.cursor/rules/`, others → no scanning. This matches the dialect convention, avoids redundant scanning, and is consistent with command/skill resolution.

**Alternatives considered:**
- Always scan both conventions: Would load redundant instructions if both conventions exist, slightly more scanning overhead
- Configurable via engine config: Would add config complexity, most users will want the dialect-matched convention

### Decision: Skip files without frontmatter silently
**Why:** Only files with explicit YAML frontmatter (`---` delimited) are included in the system prompt. Files without frontmatter are silently skipped — no warning logged, no content injected.

**Alternatives considered:**
- Inject full content with warning: Would be equivalent to autoApply: true behavior, but less predictable

### Decision: No size limit for autoApply files
**Why:** User has full control via autoApply flag. No silent data loss from truncation. If a file has autoApply: true, inject the entire content without truncation.

**Alternatives considered:**
- Warn and truncate at 8KB: Would prevent token exhaustion from large files, but truncation could cut off important content

### Decision: Instruction interface with extended fields
**Why:** Returns structured Instruction[] array with fields: name (filename stem), description (from frontmatter), content (full file content only if autoApply), sourcePath (absolute file path). Structured array provides better testability, engine-level control over formatting, and easier logging/filtering.

**Alternatives considered:**
- Simple string block: Would be simpler, but engines wouldn't have control over formatting, harder to test

### Decision: Keep (worktreePath, projectPath?) parameter naming
**Why:** User chose to keep existing names. The semantics remain: worktreePath = git worktree root, projectPath = monorepo project root (higher priority). No renaming needed across the codebase.

**Critical clarification:** `cwd` is ALWAYS the projectPath (monorepo root). The PiDialectResolver method signature is `getInstructions(cwd: string, gitWorktreeRootPath: string)` — NOT `getInstructions(worktreePath, projectPath)`.

## Risks / Trade-offs

**[Risk] Frontmatter parsing edge cases** → Graceful null handling. Files with malformed frontmatter or missing frontmatter are silently skipped. No error thrown, no partial content injected.

**[Risk] Large autoApply files could consume significant tokens** → No size limit per decision. User has full control via autoApply flag. If token issues arise, users can set autoApply: false.

**[Risk] DB lookup latency for projectPath resolution** → Existing pattern used by listCommands() in both engines. Cached lookups available via project-store. Minimal additional latency.

**[Risk] SDK behavior changes** → Monitor SDK updates. The Cursor SDK's settingSources and Copilot SDK's systemMessage APIs are stable but could change.

**[Risk] Deduplication of instruction names across paths** → Use Set<string> by instruction name. When projectPath differs from worktreePath, both paths are scanned. If the same filename exists in both, only the projectPath version is included (first occurrence wins).

**[Trade-off] Minimal interface change (getDialectName) + engine-specific logic** → Each engine handles instruction injection differently (Pi: enrichedSystem, Copilot: systemMessage append, Cursor: no change needed). The interface gains only `getDialectName()` so PiDialectResolver can resolve conventions explicitly; the rest of the scanning/injection logic stays engine-level.

**[Trade-off] Dialect-agnostic scanner requires convention mapping** → Slightly more complex than a dialect-aware scanner, but follows SRP and is more testable. The mapping layer is simple and easy to extend.

## Migration Plan

**No migration needed.** All changes are additive or bug fixes:
- New utility module: No existing code depends on it
- New PiDialectResolver method: No existing code calls it
- Engine changes: Existing behavior is preserved, new behavior is additive
- Bug fix: Existing behavior is fixed, no breaking changes

**Rollback:** Revert the commit. No data migration or config changes required.


## Test Strategy

### Test Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     TEST PYRAMID                                │
│                                                                 │
│                    ┌───────────────┐                            │
│                    │ Playwright E2E │  ← UI-level, API mocked   │
│                    │  (minimal)     │                            │
│                     └───────┬───────┘                            │
│                             │                                    │
│              ┌──────────────┼──────────────┐                     │
│              │ Integration Tests           │                     │
│              │ In-memory DB + DI mocks     │                     │
│              │ (Pi/Copilot/Cursor engines) │                     │
│               └─────────────┬──────────────┘                     │
│                             │                                    │
│      ┌──────────────────────┼──────────────────────┐            │
│      │       Unit Tests                       │            │
│      │  instruction-scanner.ts (pure functions)│            │
│      │  Dialect classes (filesystem mocks)     │            │
│      └─────────────────────────────────────────┘            │
└─────────────────────────────────────────────────────────────────┘
```

### Test Principles

1. **Dependency injection for all mocks** — no alternative code paths, no `if (test)` branches
2. **Temp directories for filesystem tests** — `mkdtempSync()` + `rmSync()` in beforeEach/afterEach (existing pattern from `cursor-dialect.test.ts`)
3. **In-memory DB for integration tests** — `initDb()` + `seedProjectAndTask()` pattern from `helpers.ts`
4. **Spy objects for verification** — `SpyDialect` pattern from `pi-harness.test.ts` and `cursor/engine.test.ts`
5. **No Playwright tests** — feature is entirely server-side; no UI surface for instruction scanning
6. **Pure function tests** — `instruction-scanner.ts` has zero dependencies (no DB, no SDK, no network)

### Test File Structure

```
src/bun/test/
├── instruction-scanner.test.ts          # NEW: Unit tests for scanner utility (~25 tests)
├── cursor-dialect.test.ts                # EXTEND: getSkillPaths projectPath scenarios (~3 tests)
├── copilot-dialect.test.ts               # No changes needed
├── cursor/
│   └── engine.test.ts                    # EXTEND: projectPath resolution scenarios (~3 tests)
├── pi-dialect-resolver.test.ts           # NEW: getInstructions() integration (~12 tests)
├── pi-engine.test.ts                     # EXTEND: instruction injection scenarios (~6 tests)
├── copilot-engine.test.ts                # NEW: instruction scanning integration (~8 tests)
└── helpers.ts                            # No changes needed
```

### Unit Test Coverage

| Module | Scenarios | Count |
|--------|-----------|-------|
| `parseFrontmatter()` | Valid frontmatter, autoApply variants, no frontmatter, malformed, empty | 10 |
| `scanInstructionsFromDir()` | Matching files, mixed extensions, empty dir, non-existent, flat scan, autoApply content | 11 |
| `getInstructionConvention()` | Copilot, cursor, unknown, empty string | 4 |
| `Instruction` interface | Required fields, optional absent, content populated | 3 |
| **Subtotal** | | **28** |

### Integration Test Coverage (In-Memory DB)

| Module | Scenarios | Count |
|--------|-----------|-------|
| `PiDialectResolver.getInstructions()` | Copilot/cursor/null dialects, priority, deduplication, no dir, logging | 12 |
| `PiEngine` instruction injection | Non-empty/empty results, formatting with/without content, ordering | 6 |
| `CopilotEngine` instruction scanning | ProjectPath resolution, project/worktree scanning, deduplication, systemMessage append, logging | 8 |
| `CursorEngine` getSkillPaths fix | ProjectPath passed, equals worktree, no project | 3 |
| **Subtotal** | | **29** |

### Playwright E2E Tests

**No new Playwright tests needed.** The feature is entirely server-side:
- No UI surface for instructions
- System prompt construction is not observable from the browser
- Existing engine-agnostic tests (`cursor.spec.ts`) already cover the execution surface

### Total Test Count: ~57 tests
## Open Questions

- Should the instruction scanner support recursive directory scanning for subdirectories? (Current decision: flat scan only, matching existing command scanning patterns)
- Should the instruction scanner support glob patterns for file matching? (Current decision: fixed extensions per convention)
- Should instruction loading be cached across executions? (Current decision: scan on each execution, similar to skill paths)
