## Context

The workflow engine has a tool-call loop that executes tools against a git worktree. Today every tool is read-only: `read_file`, `list_dir`, `run_command`, `ask_me`. The codebase has a clean extension point — `TOOL_DEFINITIONS` array + `executeTool` switch + `resolveToolsForColumn` — that makes adding new tools straightforward.

Two capabilities are being added:

1. **Write tools** — agents can mutate the worktree (create files, patch files, delete, rename)
2. **Spawn-agent tool** — agents can delegate sub-tasks to parallel in-memory child runs that share the parent worktree

The column `tools` config already accepts an array of tool names. We extend it to also accept group names so columns can reference a category (e.g. `write`) rather than a list of individual tools.

## Goals / Non-Goals

**Goals:**
- Add `write_file`, `replace_in_file`, `delete_file`, `rename_file` tools — all path-safe (worktree-confined)
- Add `search_text` (regex grep), `find_files` (glob) tools
- Add `spawn_agent` tool: engine intercepts the call, fans out N child `runExecution`-like invocations in parallel (same worktree), collects result strings, returns them to the parent as a JSON array
- Define built-in tool groups (`read`, `write`, `search`, `shell`, `interactions`, `agents`) — hardcoded in `tools.ts`
- Extend `resolveToolsForColumn` to expand group names into their constituent tools, while keeping individual tool names working as before
- Update workflow YAML to use group names

**Non-Goals:**
- Per-project custom tool groups (no YAML-defined group overrides in v1)
- Dry-run / write-approval flow (deferred)
- Sub-agents creating their own worktrees or Task DB records (Option B/C — deferred)
- Persistent sub-agent memory across runs

## Decisions

### D1 — Option A for spawn_agent: shared worktree, in-memory runs

Sub-agents share the parent worktree and run as in-memory Promise.all fan-outs. No new Task or Execution DB records are created for children.

**Alternatives considered:**
- Option B (per-sub-agent git branch): strong isolation but introduces merge complexity and is overkill for v1. The model is responsible for dividing work across non-overlapping paths.
- Option C (read-only sub-agents): too limiting — defeats the purpose of delegation for coding tasks.

**Rationale:** Simplest implementation that delivers real value. A `scope` hint field in the tool call documents what paths each sub-agent should touch — not enforced in v1, but signals intent to the model.

### D2 — replace_in_file uses old_string / new_string (not unified diff)

The model reads the file first to get exact context, then passes the literal text to replace. No line numbers, no diff hunks.

**Alternatives considered:**
- Unified diff (`apply_patch`): LLMs generate incorrect line numbers and context lines reliably. Brittle in practice.
- Full file rewrite via `write_file`: fine for new/small files but burns context window on large ones.

**Rationale:** The `old_string → new_string` pattern is the most model-reliable approach for surgical edits. Matches how Copilot's own tooling works.

### D3 — Group names resolved at runtime by resolveToolsForColumn

`TOOL_GROUPS` is a `Map<string, string[]>` defined in `tools.ts` mapping group name → tool names. `resolveToolsForColumn` checks each entry in the `tools` array: if it's a known group name, expand it; if it's a known tool name, include it; otherwise warn and skip. No YAML definition of groups in v1.

**Rationale:** Keeps config simple and groups stable. Groups are a product decision, not a user preference — hardcoding is appropriate for v1.

### D4 — spawn_agent interception mirrors ask_user interception

The engine already intercepts `ask_user` before the normal `executeTool` path and suspends execution. `spawn_agent` follows the same pattern: intercepted in the tool-call loop, runs child invocations via `Promise.all`, injects results as a tool_result message, and continues the loop. No execution suspension needed.

### D5 — Child runs use a scoped runExecution-like function

A new `runSubExecution` helper accepts `{ taskId, worktreePath, instructions, tools, parentMessages }` and runs the tool-call loop independently, returning `string`. The parent collects these strings and injects them as the tool result for the `spawn_agent` call.

`parentMessages` is NOT passed to children — each child starts fresh with only its `instructions`. This avoids context explosion when N children each receive the full parent history.

## Risks / Trade-offs

- **Concurrent writes to same file**: Two parallel sub-agents writing the same file will produce a last-write-wins race. Mitigation: rely on prompt-level scoping in v1; consider file locking in a future iteration.
- **Context window blowup**: Each sub-agent runs its own tool-call loop independently. N agents × K tool rounds can generate large amounts of text. Mitigation: sub-agents receive the same `TOOL_RESULT_MAX_CHARS` truncation; parent result strings are also truncated before injection.
- **replace_in_file ambiguity**: If `old_string` appears more than once in the file, the tool must reject the call rather than replace the wrong occurrence. The implementation will require unique matches.
- **write_file on large files**: No size limit on overwrite. Mitigated by noting in the tool description that `replace_in_file` is preferred for existing files.
- **run_command already covers write ops via shell**: A sufficiently resourceful model can write files with `echo ... > file` through `run_command`. The existing block-list catches `rm`, `mv`, etc. but not redirection. Mitigation: extend the block-list to reject shell redirections (`>`, `>>`, `tee`) in `run_command`, pushing writes through the explicit write tools where they're path-safe and auditable.
