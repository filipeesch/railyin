// filepath: openspec/changes/custom-system-prompts/design.md
## Context

The workflow engine currently builds system instructions as a static two-part join: `[workflow_instructions, stage_instructions].join("\n\n")`. This is hardcoded in `buildSystemInstructions()` in `column-config.ts` and called identically by 4 task executors (Transition, HumanTurn, Retry, CodeReview). ChatExecutor uses no system instructions. There is no mechanism for users to inject personalized prompts based on model, engine, or execution context.

The existing codebase already has an injector pattern: `CrossEngineContextInjector` and `DecisionContextInjector` are services injected into executors that prepare context blocks before execution. This pattern keeps concerns separate — each injector has a single responsibility (cross-engine history, decision records), and executors compose them.

## Goals / Non-Goals

**Goals:**
- Users can set custom system prompts in `.railyin/system-prompts/*.md` files
- Prompts are matched against fully qualified model IDs using fnmatch globs (`*`, `?`, `[abc]`, `{a,b}`)
- Global prompts (`~/.railyn/system-prompts/`) and project prompts (`<project>/.railyin/system-prompts/`) are merged, project-level takes precedence
- Multiple matching prompts are sorted by `priority` (default 50, lower = earlier/higher weight) and appended first before workflow instructions
- Prompts can be scoped to engines, execution context (`task`/`chat`/`both`), and toggled with `enabled` field
- The static `buildSystemInstructions()` function is replaced by a composable `SystemPromptAssembler` class

**Non-Goals:**
- UI for browsing/editing prompt files (out of scope — users manage `.md` files directly)
- `column` front matter field (user did not select this in decision)
- `version` front matter field (user did not select this in decision)
- Prompt validation/linting at load time
- Team sharing workflows (each user manages their own files)

## Decisions

### D1: File format — md with YAML front matter
Prompts use a `.md` file with YAML front matter. Rationale: consistent with existing `.prompt.md` and OpenSpec artifacts. Markdown body is the prompt content; front matter controls metadata. Technical choice: use `js-yaml` (already a dependency) for parsing.

```markdown
- For prompt body and metadata in one file
- Familiar format for most developers
- Front matter uses standard YAML (js-yaml already in package.json)
```

### D2: CustomPromptInjector service
A standalone service class (no DI dependencies) that handles loading, parsing, and matching. It reads global and project directories, parses YAML front matter, applies fnmatch model matching, filters by engine/context/enabled, and returns sorted prompt bodies. Technical choice: no constructor dependencies (`getDataDir` is called lazily). This is test injection. It is injected into the `SystemPromptAssembler` class (not executors directly).

Rationale: SRP (Single Responsibility Principle) — separates file loading/parsing from prompt assembly. Testable in isolation (can mock filesystem or use test fixtures). Follows the existing injector pattern (`CrossEngineContextInjector`, etc.).

**Why not hardcode in executors?** 5 executors would duplicate identical logic. Any change to matching/filtering would require updating 5 files.

**Why not replace `buildSystemInstructions()` entirely?** `buildSystemInstructions()` does a config lookup (template + column). The injector does file I/O and pattern matching. Different concerns. The `SystemPromptAssembler` class composes them.

### D3: SystemPromptAssembler class
The static function `buildSystemInstructions(config, boardId, columnId)` is replaced by a class `SystemPromptAssembler` that accepts ordered parts from multiple sources:

```ts
interface SystemPromptPart {
  content: string;
  order: number;    // lower = earlier/higher weight
  source: "workflow" | "stage" | "custom";
}

class SystemPromptAssembler {
  private parts: SystemPromptPart[] = [];
  addPart(content: string, order: number, source: SystemPromptPart["source"]);
  assemble(): string | undefined;
  
  static fromConfig(config: LoadedConfig, boardId: number, columnId: string): SystemPromptAssembler;
  addCustomPrompts(customPrompts: string[]): SystemPromptAssembler;
}
```

Rationale: Composable, testable, supports future part sources. The `addCustomPrompts()` method accepts the injector output sorted by priority and adds them as parts with order 0–99, while `fromConfig()` adds workflow (order 100) and stage (order 200).

### D4: global + project merge with precedence
Prompt files are read from both global (`~/.railyn/system-prompts/`) and project (`<project>/.railyin/system-prompts/`) directories. The match results are merged: if a project prompt matches the same model+engine/context as a global prompt, **the project prompt takes precedence** (replaces the global one). Implementation: load both lists, match both, then for each project-level match, remove any global-level match with the same `model` selector.

Rationale: Users can set personal defaults globally, override per-project. This follows the existing MCP config merge pattern. Project paths are stable and visible in the working directory.

```
~/.railyn/system-prompts/
├── 01-terse-mode.md      (global)
└── 02-portuguese-respond.md  (global)

<project>/.railyin/system-prompts/
├── 01-project-standards.md (project, overrides 01-terse-mode for this project)
└── 03-strict-validation.md (project, new package)
```

### D5: fnmatch via `minimatch` dependency
Model matching uses full fnmatch (glob standard: `*`, `?`, `[abc]`, `{a,b}`). We'll use `minimatch` package — it's widely used, well-tested, and supports all required patterns. Added to package.json as a production dependency.

```ts
import { minimatch } from "minimatch";

// model: *qwen3*  → matches: "opencode/lmstudio/qwen3-8b" ✓
// model: *qwen3*  → matches: "anthropic/qwen3-14b"       ✓
// model: opencode/* → matches: "opencode/lmstudio/qwen3-8b" ✓
```

Rationale: Simple `*`/`?` inline matcher is only 15 lines but lacks `[abc]` and `{a,b}`. `minimatch` handles all standard glob patterns, is well-tested, and is ~3x smaller than full `glob` package. Trade-off: adds a dependency (~25KB gzipped).

### D6: Custom prompts FIRST in system instruction stack
Custom prompts appear **before** workflow and stage instructions. The assembled system prompt reads:

```
[custom prompt 1]
[custom prompt 2]
...
[workflow_instructions]
...
[stage_instructions]
```

Rationale: User preferences have highest weight. If a user wants to rotate how their model behaves globally, that should override workflow defaults. The `priority` field allows fine-tuning within the custom prompt set.

### D7: Chat sessions included with `context` field
`ChatExecutor` currently has no system instructions. Custom prompts become the sole system prompt when `context` is `chat` or `both` (default). This gives personal/organization in all AI interactions.

The `context` front matter field controls scope:
- `task`  → only task executions (Transition, HumanTurn, Retry, CodeReview)
- `chat`  → only standalone chat (ChatExecutor)
- `both`  → both (default)

Rationale: Some prompts should apply only when working on a task. `context` field gives explicit control without needing duplicate files.

## Risks / Trade-offs

| Risk | Impact | Mitigation |
|------|--------|------------|
| Bad YAML in prompt file | Crash at load time | Parse file with try/catch. If YAML parse fails → skip file + log warning with file path |
| Bad fnmatch pattern | Minimatch throws, crash at load | `minimatch(pattern)` → skip file + log warning with file path |
| Too many matching prompts → context overflow | Prompt stack exceeds context window | Max 10240 chars of custom prompts per execution. If exceeded, truncate with warning. User: `*** 3 more prompts cut off ***` |
| Prompt injection via model field | If `model` field is left blank? Blank line | `model` field is **required**. Files without `model` in front matter → skip + log warning |
| Anthropic prompt caching break | Custom prompt changes break across rounds | Custom prompts are static files. Only change when user edits. Care! (user is warned in editor). Cache still works within a single execution (implements not change during execution) |
| worktree doesn't have `.railyin/` directory | Project-level prompts not found | Fallback to workspace `configDir` (where `workspace.yaml` lives). The slash-command lookup pattern: `workingDirectory` → `configDir` → global |

## Migration Plan

- **No database migration needed** — entirely file-based configuration
- **No breaking API changes** — no RPC or TypeScript changes
- **Backward compatible** — executors that called `buildSystemInstructions()` now call `SystemPromptAssembler.fromConfig(...).assemble()` with identical output when no custom prompts exist
- **Rollback**: If issues arise, users simply rename or delete `.railyin/system-prompts/` directories. The system degrades gracefully to workflow instructions only

## Open Questions

- Should we provide a UI in the future? (Out of scope now)
- Should prompts support loading order override with `priority`? — `priority` supports this.
