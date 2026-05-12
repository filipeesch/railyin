// filepath: openspec/changes/custom-system-prompts/specs/custom-system-prompts/spec.md
## ADDED Requirements

### Requirement: Custom system prompt files are stored as markdown with YAML front matter
The system SHALL read custom system prompt files from `~/.railyn/system-prompts/*.md` (global) and `<project>/.railyin/system-prompts/*.md` (project-level). Each file SHALL contain YAML front matter between `---` delimiters and a markdown body. The front matter SHALL include a `model` field (required) and MAY include `description`, `engine`, `priority`, `enabled`, and `context` fields.

#### Scenario: Prompt file with valid front matter is parsed
- **WHEN** a file `~/.railyn/system-prompts/01-terse.md` contains:
  ```yaml
  ---
  model: *qwen3*
  description: "Be concise"
  priority: 10
  ---
  Respond concisely.
  ```
- **THEN** the system parses the front matter (`model`, `description`, `priority`) and extracts the markdown body as the prompt content

#### Scenario: File without model field is skipped with warning
- **WHEN** a prompt file exists without a `model` field in front matter
- **THEN** the system skips that file and logs a warning

#### Scenario: File with bad YAML is skipped with warning
- **WHEN** a prompt file has malformed YAML front matter (e.g., missing `---` or syntax error)
- **THEN** the system skips that file and logs a warning with the file path

#### Scenario: Empty directory produces no prompts
- **WHEN** the `~/.railyn/system-prompts/` directory exists but contains no `.md` files
- **THEN** no custom prompts are loaded, the system continues normally without error

### Requirement: Model selector uses fnmatch pattern matching against qualified model ID
The `model` field SHALL be matched against the fully qualified model ID (e.g. `anthropic/claude-sonnet-4-6`, `opencode/lmstudio/qwen3-8b`) using fnmatch glob patterns. The pattern SHALL support `*` (match any characters), `?` (match single character), `[abc]` (character class), `[!abc]` (negated class), and `{a,b}` (alternation).

#### Scenario: Wildcard pattern matches qualified model ID
- **WHEN** a prompt file has `model: *qwen3*` and the execution model ID is `opencode/lmstudio/qwen3-8b`
- **THEN** the pattern matches and the prompt is included

#### Scenario: Prefix pattern matches qualified model ID
- **WHEN** a prompt file has `model: anthropic/*` and the execution model ID is `anthropic/claude-sonnet-4-6`
- **THEN** the pattern matches and the prompt is included

#### Scenario: Exact match works
- **WHEN** a prompt file has `model: anthropic/claude-sonnet-4-6` and the execution model ID is `anthropic/claude-sonnet-4-6`
- **THEN** the pattern matches and the prompt is included

#### Scenario: Non-matching model is excluded
- **WHEN** a prompt file has `model: *qwen3*` and the execution model ID is `anthropic/claude-opus-4-1`
- **THEN** the pattern does not match and the prompt is excluded

### Requirement: Engine scope filters prompts by engine type
The `engine` field SHALL be an optional string or comma-separated list of engine IDs. When present, the prompt SHALL only be matched if the execution's engine ID is in the list. When absent ALL engines match.

#### Scenario: Single engine restriction
- **WHEN** a prompt file has `engine: opencode` and the execution uses the `opencode` engine
- **THEN** the prompt is included (if model also matches)

#### Scenario: Multiple engine restriction
- **WHEN** a prompt file has `engine: opencode,anthropic` and the execution uses `opencode`
- **THEN** the prompt is included (if model also matches)

#### Scenario: Engine mismatch excludes prompt
- **WHEN** a prompt file has `engine: opencode` and the execution uses `anthropic`
- **THEN** the prompt is excluded regardless of model match

#### Scenario: No engine field matches all engines
- **WHEN** a prompt file has no `engine` field and the execution uses any engine
- **THEN** the engine filter does not exclude the prompt

### Requirement: Context field controls execution scope (task vs chat)
The `context` field SHALL be an optional value: `task`, `chat`, or `both`. When `task`, the prompt only applies to task executions (Transition, HumanTurn, Retry, CodeReview executors). When `chat`, it only applies to standalone chat executions (ChatExecutor). When `both` or absent, it applies to all executions.

#### Scenario: Task-only prompt excluded from chat
- **WHEN** a prompt file has `context: task` and a standalone chat execution runs
- **THEN** the prompt is excluded from the chat session

#### Scenario: Chat-only prompt excluded from task
- **WHEN** a prompt file has `context: chat` and a task execution runs (any executor)
- **THEN** the prompt is excluded from the task execution

#### Scenario: Default context applies to both
- **WHEN** a prompt file has no `context` field (or `context: both`)
- **THEN** the prompt applies to both task executions and standalone chat

### Requirement: Enabled field toggles prompt without file deletion
The `enabled` field SHALL be an optional boolean. When `enabled: false`, the prompt file SHALL be skipped during matching, even if all other selectors the file. When `enabled: true` or absent, the prompt is processed normally.

#### Scenario: Disabled prompt is skipped
- **WHEN** a prompt file has `enabled: false`
- **THEN** the file is skipped during model matching and does not appear in the system instruction assembly

#### Scenario: Enabled default when field absent
- **WHEN** a prompt file has no `enabled` field
- **THEN** the prompt is treated as enabled (`enabled: true` equivalent)

### Requirement: Priority field orders custom prompts within the system instruction stack
The `priority` field SHALL be an optional numeric value (default: 50). When multiple prompts match, they SHALL be sorted by `priority` in ascending order (lower = earlier in the system prompt, higher weight for the LLM). When absent, defaults to `50`.

#### Scenario: Lower priority appears first
- **WHEN** two prompts match: one with `priority: 10`, one with `priority: 50`
- **THEN** the prompt with `priority: 10` appears earlier in the assembled system instructions

#### Scenario: Default priority between explicit values
- **WHEN** one prompt has `priority: 20` and another has no `priority` field
- **THEN** the prompt with `priority: 20` appears before the default-priority (50) prompt

### Requirement: Global and project prompts are merged with project precedence
The system SHALL load prompts from both `~/.railyn/system-prompts/` (global) and `<project>/.railyin/system-prompts/` (project-level) directories. When a project-level prompt matches the same model+engine+context combination as a global prompt, the project-level prompt SHALL take precedence (the global one is excluded for that execution). Implementation: project prompts replace global prompts with identical `model` selector pattern during merge.

#### Scenario: Project prompt replaces global for same model
- **WHEN** global has `model: opencode/*` and project has `model: opencode/*` with different content
- **THEN** the project prompt replaces the global one for that execution

#### Scenario: Non-overlapping prompts are merged
- **WHEN** global has `model: anthropic/*` and project has `model: opencode/*`
- **THEN** both prompts are included if models match

#### Scenario: Project prompt for different model adds to global
- **WHEN** global has `model: opencode/*` and project has `model: lmstudio/*`
- **THEN** both prompts are included in the execution (if models match)

### Requirement: Custom prompts appear first in system instruction assembly
When assembling the final system prompt, custom prompt content SHALL appear BEFORE workflow instructions and stage instructions. The order is:
1. Custom prompts (sorted by `priority`, ascending)
2. Workflow instructions (from `workflow.yaml` `workflow_instructions`)
3. Stage instructions (from workflow column `stage_instructions`)

#### Scenario: Custom prompts before workflow instructions
- **WHEN** a custom prompt matches and workflow_instructions exist
- **THEN** the assembled system prompt has custom prompt content followed by workflow instructions, separated by `\n\n`

#### Scenario: No custom prompts yields identical output to workflow instructions only
- **WHEN** custom prompt files exist but none match the current model/engine/context
- **THEN** the system outputs only workflow_instructions and stage_instructions (identical to pre-feature behavior)

### Requirement: SystemPromptAssembler class replaces static buildSystemInstructions function
The system SHALL provide a `SystemPromptAssembler` class in `src/bun/engine/execution/system-prompt-assembler.ts`. The class SHALL accept parts from multiple sources and assemble them by order/priority. The previous `buildSystemInstructions()` function SHALL be removed from `src/bun/workflow/column-config.ts`.

#### Scenario: Static factory creates assembler from config
- **WHEN** executors call `SystemPromptAssembler.fromConfig(config, boardId, columnId)`
- **THEN** the assembler includes parts for workflow_instructions (order 100) and stage_instructions (order 200)

#### Scenario: addCustomPrompts adds injector output
- **WHEN** executors call `assembler.addCustomPrompts(prompts)`
- **THEN** the prompts are sorted by priority (order 0–99) and added before workflow instructions (order 100+) in the final assembly

#### Scenario: Assemble returns joined string or undefined
- **WHEN** execute assemble.assemble()
- **THEN** returns a joined string of all parts sorted by order, or `undefined` if no parts exist

### Requirement: Custom prompts are injected into chat sessions too
When executing standalone chat (ChatExecutor), custom prompts SHALL be included as the sole source of system instructions (no workflow/column context exists). The `context: chat` or `context: both` field controls whether a specific prompt applies to chat.

#### Scenario: Chat executes with custom prompts
- **WHEN** a chat session runs with matching custom prompts
- **THEN** the system prompt includes those custom prompts as body content

#### Scenario: Chat with context: task prompt excluded
- **WHEN** a prompt has `context: task` and a chat session runs
- **THEN** the prompt is excluded from chat system instructions

### Requirement: Bad patterns are skipped gracefully
When a prompt file's `model` field contains an invalid fnmatch pattern (e.g., unbalanced `[` or `(`), the system SHALL skip that file and log a warning. The file SHALL NOT crash the loading process.

#### Scenario: Invalid pattern skipped
- **WHEN** a prompt file has `model: *qwen[3*` (unbalanced bracket)
- **THEN** the file is skipped, a warning is logged, other files are processed normally
