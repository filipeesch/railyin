## Why

Software delivery teams using AI agents lack a coordination layer that ties workflow state, persistent task context, and execution history together. Today, tasks are cards, chat is separate, and agent outputs are lost across sessions. Railyn unifies these into a single tool where each task is simultaneously a workflow item, a persistent chat session, and an execution container — orchestrated by configurable workflow stages.

## What Changes

This is the initial build of Railyn — a greenfield project. There is no existing codebase to modify.

- New Electrobun desktop application with Vue.js + PrimeVue (Sakai theme) frontend
- SQLite persistence for all runtime data (workspaces, boards, projects, tasks, conversations, executions)
- YAML-based workflow configuration (columns, on_enter_prompt, stage_instructions)
- Board UI: configurable Kanban-style columns with task cards showing dual state
- Task model with two independent state dimensions: workflow state (business) and execution state (operational)
- Persistent chat conversation per task — one unified timeline across all transitions and retries
- Transition-triggered AI execution: entering a column runs the configured prompt automatically
- Stage instructions: always-injected system context per column to keep AI on-task
- Human turn-taking inside task chat after execution completes
- Retry support: re-runs the current column's prompt in-place, appending to the existing conversation
- Task-created tasks: executions can spawn new backlog tasks with provenance tracking
- Git worktree per task: created when a task first leaves Backlog, tracked in SQLite
- AI provider abstraction targeting OpenAI-compatible endpoints (OpenRouter as default, Ollama and LM Studio supported out of the box)
- Monorepo support: projects track both `project_path` and `git_root_path` independently

## Capabilities

### New Capabilities

- `workspace`: Top-level workspace container holding boards, projects, workflow templates, and AI provider configuration
- `board`: Workflow board with configurable columns derived from YAML; coordinates tasks from one or more projects
- `project`: Folder-based project registration supporting standalone repos and monorepo sub-projects
- `task`: Core unit of work with dual state model (workflow state + execution state), conversation ownership, and Git worktree association
- `conversation`: Persistent chat timeline per task accumulating user messages, assistant responses, tool calls, transition events, and system messages across all executions and retries
- `workflow-engine`: YAML-configurable workflow columns with on_enter_prompt, stage_instructions, and transition execution lifecycle management
- `ai-provider`: OpenAI-compatible HTTP client abstraction with streaming support; configured via base_url + api_key + model; OpenRouter as default provider
- `git-worktree`: Per-task Git worktree lifecycle — creation on first active transition, branch tracking, worktree status management, monorepo-aware

### Modified Capabilities

_None — this is the initial version of the product._

## Impact

- **New runtime**: Electrobun (Bun-based) desktop application — no existing runtime affected
- **Storage**: SQLite database managed by Bun's native `bun:sqlite` — no external database required
- **Configuration**: YAML files for workflow templates and AI provider settings — no environment-specific infrastructure required
- **External dependencies**: Git CLI (worktree operations), OpenRouter API (or any OpenAI-compatible endpoint), system WebView (Electrobun requirement)
- **Platform**: macOS primary target. Linux supported via WebKitGTK (known rendering variability — tracked as known risk)
- **Future multi-user path**: Workspace concept seeded in schema from day one to enable future server-side tenancy without schema migration
