## Context

Railyn is a new desktop application — there is no existing codebase or migration. All decisions here are greenfield choices.

The core product insight driving the design: a task is simultaneously a workflow item, a persistent conversation, an execution container, and a Git worktree owner. The data model must serve all four roles without compromise.

## Goals / Non-Goals

**Goals:**
- Deliver a working local desktop application for a single user managing tasks across one board
- Prove the core loop: board → transition → AI execution → conversation timeline → retry
- Design the schema to accommodate future multi-user/server deployment without requiring migration
- Keep external dependencies minimal: no required database server, no required cloud services

**Non-Goals:**
- Multi-user authentication or authorization (seeded in schema, not implemented)
- Deployment orchestration, CI/CD integration, or built-in review engines
- Multiple worktrees per task
- Advanced task relationship taxonomy or dependency graphs
- Cross-provider session synchronization (Claude Projects, Cursor, Copilot)

## Decisions

### D1: Electrobun as the application shell

**Decision**: Use [Electrobun](https://electrobun.dev) — a TypeScript/Bun-native desktop app framework using the system WebView.

**Alternatives considered**:
- **Electron**: Bundles ~100MB Chromium, heavy binary. Node.js backend. Mature but bloated for a single-user local tool.
- **Tauri**: Rust backend, smaller binary, system WebView. Good option, but Bun is not natively supported — bridging adds complexity.
- **Electrobun**: Bun backend natively, small binary, system WebView. The Bun alignment means one language/runtime end-to-end.

**Rationale**: Bun is used for the backend (SQLite via `bun:sqlite`, HTTP calls, Git subprocess). Electrobun uses Bun natively, so there's no backend language boundary. The tradeoff is maturity — Electrobun is young, and WebKitGTK on Linux has known rendering variability. Accepted for MVP.

**Risk**: See R1.

---

### D2: Vue.js + PrimeVue (Sakai theme) for the frontend

**Decision**: The WebView renders a Vite-built Vue.js application using PrimeVue component library with the Sakai app template.

**Alternatives considered**:
- **React**: Most popular, but no user preference expressed. Vue is equivalent in capability here.
- **SvelteKit**: Lighter, but less component ecosystem.

**Rationale**: Sakai provides a full admin-app layout (sidebar, panels, data tables, kanban primitives) out of the box. PrimeVue's `DataView` and drag-and-drop utilities are sufficient for the board UI without custom components.

**IPC flow**:
```
Vue component
  → Electrobun IPC call (typed)
  → Bun handler
  → SQLite / git / AI API
  → return value
  → Vue reactive update
```

---

### D3: SQLite via bun:sqlite for runtime persistence

**Decision**: All runtime data (workspace, boards, projects, tasks, conversations, messages, executions) is stored in a single SQLite file managed by Bun's built-in `bun:sqlite` module.

**Alternatives considered**:
- **PostgreSQL/MySQL**: Requires a running server. Unnecessary for single-user local app.
- **IndexedDB in renderer**: Frontend-side storage, poor for Git and AI operations that run in the backend process.

**Rationale**: `bun:sqlite` is synchronous, embedded, zero-config, and very fast for single-user workloads. The entire app state is one file — trivially backupable and portable.

**Future path**: A future multi-user deployment would introduce a server process and swap the persistence layer. The schema already includes a `workspace_id` column on top-level entities so tenancy can be added without migration.

---

### D4: YAML for workflow configuration

**Decision**: Workflow templates, column definitions (`on_enter_prompt`, `stage_instructions`), and AI provider settings are stored in YAML files. Runtime state (task positions, execution status) is stored in SQLite.

```
config/
  workspace.yaml     ← AI provider config
  workflows/
    delivery.yaml    ← column definitions, prompts, stage instructions
```

**Rationale**: YAML is ideal for configuration that users may want to inspect, version-control, and share. It's not ideal for runtime mutable state. The split is: config (structure, prompts) in YAML; data (tasks, messages) in SQLite.

**Alternatives considered**:
- **Storing column config in SQLite**: Makes templates database-driven, adds a UI for editing. Heavy for MVP; templates are better as files users can share.
- **TOML**: Equally valid, YAML has broader familiarity.

---

### D5: OpenAI-compatible HTTP abstraction for AI providers

**Decision**: All AI calls use the OpenAI chat completions API format (`POST /v1/chat/completions`). Provider is configured by `base_url + api_key + model` in YAML.

```yaml
ai:
  base_url: https://openrouter.ai/api/v1
  api_key: sk-or-...
  model: anthropic/claude-3.5-sonnet
```

**OpenRouter as default**. Ollama (`http://localhost:11434/v1`) and LM Studio (`http://localhost:1234/v1`) work with zero code changes.

**Streaming**: Responses are streamed via SSE and appended to the conversation in real time as they arrive.

**Abstraction layer**: A thin `AIProvider` interface in Bun exposes `chat(messages, options)` → `AsyncIterable<token>`. The concrete implementation targets the OpenAI format. Future providers (Anthropic native, Gemini) can implement the same interface with a shim.

---

### D6: Dual state model — workflow state and execution state as separate fields

**Decision**: A task has two distinct state fields: `workflow_state` (business position in the board) and `execution_state` (operational status within that column).

**Rationale**: Conflating these two dimensions is the root cause of boards that lie. A task can be "In Review" (workflow state) and "failed" (execution state) simultaneously — the board shows both, accurately. Moving a task to a new column immediately updates `workflow_state`; the execution running in that column governs `execution_state`.

```
workflow_state: in_review      ← set on transition, represents column
execution_state: waiting_user  ← set by execution result, represents workload
```

---

### D7: Conversation as a unified append-only log

**Decision**: Each task owns one conversation. All executions, retries, user turns, and transition events append to that single timeline. There is no separate per-execution log.

**Rationale**: The conversation is the memory. When a retry runs, the AI receives the full prior context — avoiding repeating already-done work. The user sees one coherent story, not disconnected execution fragments. The timeline is the source of truth.

**Message assembly for AI calls**: When invoking the AI (on_enter_prompt or human turn), Railyn assembles:
1. A system message containing `stage_instructions` from the current column
2. All prior conversation messages for this task (turn-taking history)
3. The new user/prompt message

This gives the model full context of the task's history while the stage_instructions anchor it to the current workflow stage.

---

### D8: worktree creation deferred to first active transition

**Decision**: A task's Git worktree is created when the task first leaves Backlog and enters an active state. Tasks that remain in Backlog never get a worktree.

```
worktree_status: not_created  ← until first active transition
worktree_status: creating     ← during git worktree add operation
worktree_status: ready        ← worktree available for use
worktree_status: failed       ← creation failed, execution blocked
```

**Worktree directory**:
```
/worktrees/<project-id>/<task-id>/
```
Configurable in `workspace.yaml`. Created outside the repository to avoid nested git structures.

**Monorepo**: `git worktree add` runs from `git_root_path`. The agent receives both `project_path` and `git_root_path` as part of the execution payload, so it knows where to scope changes.

---

### D9: Stage instructions injection

**Decision**: Each workflow column may define `stage_instructions` — a string injected as a system message into every AI call made while a task is in that column. This applies to both the `on_enter_prompt` trigger and any subsequent human turns.

**Purpose**: Prevent the model from drifting outside the intent of the current workflow stage. Example: the Plan column injects "This is the planning phase. Do not write code. Focus on what and why, not how." This is enforced per-message, not once at session start.

---

### D10: Single workspace for MVP, workspace_id seeded for future

**Decision**: MVP supports exactly one workspace (the local user's workspace). The database schema includes `workspace_id` as a foreign key on boards and projects. The current workspace is always ID 1.

**Future**: A multi-user server deployment would add an auth layer and make `workspace_id` meaningful for tenancy isolation. The schema requires no changes.

---

### D11: Context compaction — SQLite as source of truth, compacted view sent to AI

**Decision**: The SQLite conversation store is always the full, uncompressed record. Compaction applies only to the message array assembled for each AI request — it never modifies stored data.

**Why this matters**: File editing executions inflate context rapidly. A single implementation run that reads and writes source files can consume 20–40K tokens in tool calls and tool results alone. Across retries and multiple transitions, context limits become a real risk.

```
SQLite (source of truth)       AI request (assembled per call)
────────────────────────       ────────────────────────────────
Full history, never lost  →    Compacted view of history
All tool calls/results         Truncated tool results
All message types              Filtered to what model needs
```

**MVP compaction strategy — selective tool result truncation (Strategy D)**:
- Always include: system message + `stage_instructions`, original task description, all `user` and `assistant` messages in full
- Truncate: individual `tool_result` messages exceeding ~2,000 tokens to a truncation notice (`[truncated — full content stored in conversation history]`)
- Keep: `tool_call` messages in full (they are small and give the model operation context)
- Drop: nothing — only truncate, never omit message entries

**Rationale**: Tool results (file contents, command output) are the primary token offender. Assistant and user turns are comparatively small. Truncating only tool results targets the bulk of the problem with minimal complexity. The full content remains in SQLite — the model can re-read files fresh if needed.

**Post-MVP compaction strategies** (when tasks grow long):
- **Summarize-then-truncate**: when approaching a configurable token threshold, ask the model to summarize the conversation so far and replace middle history with the summary
- **Tiered retention**: always pin system context + task description + last N full turns; compress middle history

**Token threshold for warnings**: Warn the user in the task detail view when the estimated assembled context exceeds 80% of the configured model's context window. Threshold is configurable in `workspace.yaml`.

## Risks / Trade-offs

| Risk | Mitigation |
|---|---|
| **R1: Electrobun immaturity** — framework is young, APIs may change | Pin Electrobun version. Abstract IPC calls behind a thin service layer so the Bun↔WebView bridge can be swapped. |
| **R2: WebKitGTK on Linux** — known rendering inconsistencies | Accept as known limitation for MVP. Document macOS as primary target. Test on Linux in Phase 1. |
| **R3: Long conversations exceeding context window** — unified log grows unbounded | For MVP: pass full conversation to AI (acceptable for short-lived tasks). Post-MVP: implement sliding window or summary injection. |
| **R4: Streaming partial failures** — SSE stream drops mid-response | On stream error, mark execution as `failed` and append a system message to the conversation. The full partial response up to that point is retained. Retry re-runs the prompt. |
| **R5: Git worktree conflicts** — branch name collisions in monorepos with many tasks | Branch name includes task ID. Collision is structurally impossible unless task IDs collide (they won't with UUID/sequential IDs). |
| **R6: YAML misconfiguration** — invalid workflow config blocks app startup | Validate YAML on load. Show a config error screen instead of crashing. Provide a default workflow template bundled in the app. |

## Open Questions

- **Electrobun IPC typing**: Does Electrobun support typed IPC schemas, or is this manual? Investigate before Phase 1 implementation.
- ~~**PrimeVue Kanban**~~: Resolved — PrimeVue component library is available and will be used for all UI components including the board. No additional drag-and-drop library required beyond what PrimeVue provides.
- ~~**Conversation truncation strategy**~~: Resolved — see D11. MVP uses selective tool result truncation. Warning threshold is 80% of model context window, configurable in `workspace.yaml`.
