## Context

Railyin's workflow engine uses `on_enter_prompt` and `stage_instructions` as inline strings in workflow YAML. There is no mechanism to reference external prompt files. Projects that maintain prompt libraries (e.g., `.github/prompts/` following the OpenSpec or VS Code Copilot convention) must copy content into workflow YAML or rely on the AI to load files ad-hoc. This creates drift and friction.

The `slash-prompt-resolution` change introduces a reference syntax — `/stem` (e.g., `/opsx-propose`) — that Railyin resolves at execution time by reading a prompt file from the project's worktree. The same syntax works in task chat input, giving users explicit control over which prompt to apply mid-conversation. Resolution only triggers when the slash reference appears at the very beginning of the value — it is not resolved inline.

## Goals / Non-Goals

**Goals:**
- Resolve `/stem` in `on_enter_prompt` and `stage_instructions` when it is the entire value
- Resolve `/stem` when a user chat message starts with that pattern (and only when it starts with it)
- Read the prompt body from `{worktreePath}/.github/prompts/{stem}.prompt.md`
- Strip YAML frontmatter before injection
- Substitute `$input` with any text following the slash reference
- Surface a clear error (not a silent failure) when the file is not found

**Non-Goals:**
- Resolving slash references at YAML load time (worktree doesn't exist yet)
- Supporting paths other than `.github/prompts/`
- Recursively resolving slash references inside a resolved prompt body
- A command palette or slash-command autocomplete UI (future work)

## Decisions

### Resolution happens at execution time, not at YAML parse time

**Decision**: Resolve `/stem` lazily when the column is entered or a human turn is processed.

**Rationale**: Workflow YAML is loaded globally at startup, before any task or worktree exists. The same workflow template may be used by tasks from different projects — each would resolve to a different worktree. Early resolution would require worktree context that doesn't exist yet, and would couple the YAML loader to worktree management.

**Alternative considered**: Pre-resolve at board/column load time, scoped per project. Rejected — adds complexity and still fails for boards spanning multiple projects.

---

### Resolution path is always `.github/prompts/`

**Decision**: `/stem` always maps to `.github/prompts/{stem}.prompt.md` relative to the worktree root.

**Rationale**: This is identical to the VS Code Copilot convention. Projects already using OpenSpec with Copilot have these files — Railyin resolution is zero-config. Any other path would require additional configuration.

**Alternative considered**: A configurable `prompts_dir` in `workspace.yaml`. Rejected — adds config surface for little gain; the convention is already established.

---

### Slash reference must be at the beginning

**Decision**: A value (YAML field or chat message) is treated as a slash reference only if it starts with `/stem`. Inline occurrences — e.g., `"here is my plan /opsx-sync the rest"` — are ignored.

**Rationale**: Unambiguous. Avoids accidentally resolving `/` in URLs or file paths that appear mid-string. Users can always send the slash command as a standalone message or set the YAML field to just the reference.

---

### Resolution failure is a hard error, not a fallthrough

**Decision**: If the referenced file is not found, the execution surfaces an error to the user and does not proceed with the literal slash reference as prompt text.

**Rationale**: Silent fallthrough would send `/opsx-propose` literally to the AI, which would confuse the model and waste tokens. A hard error makes the misconfiguration obvious immediately.

## Risks / Trade-offs

- **Worktree not yet created**: If a task somehow triggers `on_enter_prompt` before its worktree is ready, resolution will fail. Mitigation: worktree creation is gated before column-entry execution; this case should be unreachable in normal flow.
- **Large prompt files**: A prompt file with several KB of content injects that into every call in the column. Mitigation: no special handling needed — this is the same risk as inline `stage_instructions` of equivalent size.
- **$input substitution with no match**: If the prompt body contains no `$input` placeholder and the user provided input text, the input is silently ignored. Mitigation: not a bug — the prompt may intentionally ignore the argument.

## Open Questions

- Should `$input` remain verbatim in the injected prompt if the file has no `$input` placeholder, or be silently dropped? (Current decision: silently dropped — no substitution means the variable isn't used.)
- Should the `description` frontmatter field be surfaced anywhere in the current UI (e.g., column tooltip)? Deferred to a later UX change.
