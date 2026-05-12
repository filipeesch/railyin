## Why

Users cannot personalize AI behavior per-project or per-model. Every execution uses the same workflow instructions regardless of which model runs it or what project context demands. This blocks use cases like: adding coding standards for specific LLMs, injecting team-specific conventions into task workflows, or applying personal preferences like response language across all interactions.

## What Changes

- **New file format**: `.railyin/system-prompts/*.md` files with YAML front matter (`model`, `enabled`, `engine`, `priority`, `context`) and markdown body
- **New service**: `CustomPromptInjector` — loads, parses, matches (fnmatch), and filters custom prompt files from global (`~/.railyn/system-prompts/`) and project-level (`<project>/.railyin/system-prompts/`) directories
- **New assembler class**: `SystemPromptAssembler` — replaces the static `buildSystemInstructions()` function. Assembles system instructions from multiple sources (workflow instructions, stage instructions, custom prompts) ordered by priority
- **Executor integration**: All executors (Transition, HumanTurn, Retry, CodeReview, Chat) use the new assembler with custom prompt injection
- **New dependency**: `minimatch` package for fnmatch-style glob pattern matching
- **Breaking**: `buildSystemInstructions()` function removed, replaced by `SystemPromptAssembler` class with `assemble()` method

## Capabilities

### New Capabilities
- `custom-system-prompts`: User-defined system prompt files that match against model names, engine types, and execution context. Loaded from global and project directories, merged with workflow/column instructions, injected at execution time.

### Modified Capabilities
- `workflow-engine`: System prompt assembly now composes custom user prompts alongside workflow/column instructions. The assembly flow changes from a static function to a composable class that accepts multiple ordered parts. Custom prompts appear first (highest weight) when `priority` field is used.

## Impact

**Code changes:**
- New files: `src/bun/engine/execution/system-prompt-assembler.ts` (new). `src/bun/workflow/column-config.ts` (modified — remove `buildSystemInstructions()`)
- Modified: `src/bun/engine/orchestrator.ts`, `src/bun/engine/execution/transition-executor.ts`, `src/bun/engine/execution/human-turn-executor.ts`, `src/bun/engine/execution/retry-executor.ts`, `src/bun/engine/execution/code-review-executor.ts`, `src/bun/engine/execution/chat-executor.ts` — all use new assembler instead of static function
- New dependency: `minimatch` (~25KB gzipped)

**No API changes** — entirely configuration-driven, no breaking RPC or WebSocket changes.
