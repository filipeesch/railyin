## 1. Dependency & Setup

- [x] 1.1 Add `minimatch` package to package.json with `bun add minimatch`
- [x] 1.2 Create new directory structure: `src/bun/engine/execution/system-prompt-assembler.ts` will be new module

## 2. Custom Prompt Injector Service

- [x] 2.1 Create `CustomPromptInjector` class in `src/bun/engine/execution/custom-prompt-injector.ts` with no constructor dependencies
- [x] 2.2 Implement global prompt loading from `~/.railyn/system-prompts/*.md` using `fs.readdirSync`
- [x] 2.3 Implement project prompt loading from `workingDirectory/.railyin/system-prompts/*.md` with fallback to `configDir` path
- [x] 2.4 Implement YAML front matter parsing (`model`, `engine`, `priority`, `enabled`, `context`, `description`)
- [x] 2.5 Implement model matching using `minimatch` fnmatch patterns against qualified model ID
- [x] 2.6 Implement engine filter (string or comma-separated list)
- [x] 2.7 Implement context filter (`task`, `chat`, `both`)
- [x] 2.8 Implement enabled filter (boolean, default enabled when absent)
- [x] 2.9 Implement global + project merge with project-level precedence (same `model` pattern → project wins)
- [x] 2.10 Implement `resolve()` method that returns sorted prompt content by priority ascending (default 50)
- [x] 2.11 Add graceful error handling: skip files with bad YAML, bad patterns, missing `model` field — log warnings

## 3. System Prompt Assembler Class

- [x] 3.1 Create `SystemPromptAssembler` class in `src/bun/engine/execution/system-prompt-assembler.ts`
- [x] 3.2 Implement `SystemPromptPart` interface (`content`, `order`, `source`):
  - `order` is numeric (lower = earlier/higher weight)
  - `source` is `"custom" | "workflow" | "stage"`
  - `addPart(content, order, source)` — adds ordered part
- [x] 3.3 Implement `fromConfig(config, boardId, columnId)` — loads workflow+stage instructions from config as parts
  - workflow_instructions → order 100, stage_instructions → order 200
- [x] 3.4 Implement `addCustomPrompts(customPrompts)` — adds custom prompt content as parts with orders 0–99 sorted by parsed priority
- [x] 3.5 Implement `assemble()` — joins all parts by order, returns joined string or `undefined`
- [x] 3.6 Remove `buildSystemInstructions()` function from `src/bun/workflow/column-config.ts`

## 4. Wire SystemPromptAssembler into executors

- [x] 4.1 Wire `TransitionExecutor` to use `SystemPromptAssembler.fromConfig().addCustomPrompts().assemble()` instead of `buildSystemInstructions()` calls
- [x] 4.2 Wire `HumanTurnExecutor` to use new assembler class
- [x] 4.3 Wire `RetryExecutor` to use custom prompt.
- [x] 4.4 Wire `CodeReviewExecutor` to use new assembler pattern
- [x] 4.5 Wire `ChatExecutor` to use `CustomPromptInjector.resolve()` as sole system instructions (no workflow/column context)
- [x] 4.6 Register `CustomPromptInjector` and pass to all executors in `Orchestrator` constructor

## 5. Code ReviewExecutor

- [x] 5.1 Update `CodeReviewExecutor` to use `SystemPromptAssembler` in constructor

## 6. ChatExecutor

- [x] 6.1 Pass `CustomPromptInjector` to `ChatExecutor` constructor. Add `.resolve()` call with model/engine, set as `systemInstructions` in exec params when context matches.

## 7. Cleanup & Dependency Injection

- [x] 7.1 Update `Orchestrator` to create `CustomPromptInjector` in constructor.
- [x] 7.2 Pass `CustomPromptInjector` and `ModelSettingsRepository` to all executors.
- [x] 7.3 Remove `buildSystemInstructions()` from all executor imports — call `SystemPromptAssembler.fromConfig().assemble()` instead.

## 8. Testing

- [x] 8.1 Write unit tests for `CustomPromptInjector` (global + project merge, model matching, engine/context/enabled filtering, priority ordering, error handling for bad YAML/patterns
- [x] 8.2 Write unit tests for `SystemPromptAssembler` (fromConfig factory, assemble(), addCustomPrompts(), ordering logic, undefined when empty)
- [x] 8.3 Write integration test: full execution flow with custom prompt injection in TransitionExecutor
- [x] 8.4 Write integration test: full execution flow with custom prompt injection in ChatExecutor
- [x] 8.5 Update existing `orchestrator.test.ts` to use `SystemPromptAssembler` instead of `buildSystemInstructions()` where tested
- [x] 8.6 Run `bun test src/bun/test --timeout 20000` and ensure all tests pass
- [x] 8.7 Test char limit exceeded (10240 chars) — truncation + warning
- [x] 8.8 Test prompt priority sorting — verify lower priority = earlier in assembled string

# Capybara
