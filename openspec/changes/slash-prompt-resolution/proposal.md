## Why

Workflow YAML columns and task chat turns have no way to reference reusable prompt files — content must be inlined, duplicated, or loaded manually by the AI. Projects using OpenSpec (or any prompt-file convention like `.github/prompts/`) can't plug those files into Railyin workflows without copying them.

## What Changes

- `on_enter_prompt` and `stage_instructions` in workflow YAML accept a `/stem` reference (e.g., `/opsx-propose`) as the **entire field value**.
- Task chat input accepts `/stem` at the **start of the message** to invoke a prompt file.
- Railyin resolves `/stem` by reading `.github/prompts/{stem}.prompt.md` from the project's worktree.
- YAML frontmatter is stripped; only the body is injected as the prompt.
- Text following the slash reference is passed into the prompt body as the `$input` substitution variable.
- Inline occurrences (slash reference in the middle of a string) are not resolved.
- Resolution failure (file not found) surfaces as a clear error, not a silent no-op.

## Capabilities

### New Capabilities

- `slash-prompt-resolution`: Convention and resolution mechanism — maps `/stem` (at the start of a value) to `.github/prompts/{stem}.prompt.md` in the project worktree, strips frontmatter, substitutes `$input`, and returns the body for injection.

### Modified Capabilities

- `workflow-engine`: `on_enter_prompt` and `stage_instructions` fields now accept either inline text or a `/stem` reference (as the entire field value). Resolution happens at execution time using the task's worktree.

## Impact

- `src/bun/workflow/engine.ts` — detect and resolve slash references before constructing AI requests.
- `src/bun/handlers/` — chat turn handler must resolve slash references in user input before forwarding to the AI.
- `config/workflows/delivery.yaml` and any built-in templates — no changes required; fully backward-compatible.
- No database schema changes required.
- No frontend changes required (chat input already captures raw text).
