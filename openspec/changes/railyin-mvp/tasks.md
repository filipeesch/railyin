## 1. Project Scaffold & Tooling

- [ ] 1.1 Initialize Electrobun project with Bun runtime
- [ ] 1.2 Set up Vite + Vue.js frontend inside the Electrobun WebView target
- [ ] 1.3 Install and configure PrimeVue component library with Sakai theme
- [ ] 1.4 Configure Electrobun IPC bridge with typed handler stubs
- [ ] 1.5 Set up SQLite database file initialization via `bun:sqlite`
- [ ] 1.6 Create database migration runner for schema versioning

## 2. Database Schema

- [ ] 2.1 Create `workspaces` table (`id`, `name`)
- [ ] 2.2 Create `projects` table (`id`, `workspace_id`, `name`, `project_path`, `git_root_path`, `default_branch`, `slug`, `description`)
- [ ] 2.3 Create `boards` table (`id`, `workspace_id`, `name`, `workflow_template_id`, `project_ids` as JSON array)
- [ ] 2.4 Create `tasks` table (`id`, `board_id`, `project_id`, `title`, `description`, `workflow_state`, `execution_state`, `conversation_id`, `current_execution_id`, `retry_count`, `created_from_task_id`, `created_from_execution_id`)
- [ ] 2.5 Create `task_git_context` table (`task_id`, `git_root_path`, `project_path`, `base_branch`, `branch_name`, `worktree_path`, `worktree_status`)
- [ ] 2.6 Create `conversations` table (`id`, `task_id`)
- [ ] 2.7 Create `conversation_messages` table (`id`, `task_id`, `conversation_id`, `type`, `role`, `content`, `metadata` as JSON, `created_at`)
- [ ] 2.8 Create `executions` table (`id`, `task_id`, `from_state`, `to_state`, `prompt_id`, `status`, `attempt`, `started_at`, `finished_at`, `summary`, `details`)
- [ ] 2.9 Seed default workspace (id=1) on first run

## 3. YAML Configuration

- [ ] 3.1 Implement YAML config loader for `workspace.yaml` (AI provider settings, worktree base path)
- [ ] 3.2 Implement YAML loader for workflow templates (columns, `on_enter_prompt`, `stage_instructions`, column order)
- [ ] 3.3 Create bundled default workflow template (`delivery.yaml`: Backlog → Plan → In Progress → In Review → Done)
- [ ] 3.4 Add startup config validation — show error screen if YAML is missing or structurally invalid
- [ ] 3.5 Expose loaded config to Bun handlers via a config singleton

## 4. AI Provider

- [ ] 4.1 Define `AIProvider` interface in Bun: `chat(messages, options) → AsyncIterable<token>`
- [ ] 4.2 Implement `OpenAICompatibleProvider` targeting `POST /v1/chat/completions` with SSE streaming
- [ ] 4.3 Handle empty/absent `api_key` — omit `Authorization` header (Ollama / LM Studio support)
- [ ] 4.4 Wire provider instantiation from `workspace.yaml` config at startup
- [ ] 4.5 Handle stream errors: catch mid-stream failures, mark execution `failed`, retain partial response

## 5. Workflow Engine

- [ ] 5.1 Implement transition handler: update `workflow_state` immediately, create execution record
- [ ] 5.2 Implement `on_enter_prompt` trigger: detect column config and initiate AI call on transition
- [ ] 5.3 Assemble execution payload (task, board, project, workflow, git, execution metadata) as message array
- [ ] 5.4 Inject `stage_instructions` as system message into every AI call
- [ ] 5.5 Implement context compaction: truncate individual `tool_result` messages exceeding 2,000 tokens before assembling AI request (preserve full content in SQLite)
- [ ] 5.6 Implement context size warning: estimate assembled token count and surface a warning in the task detail view when exceeding 80% of the model's context window
- [ ] 5.7 Implement human turn handler: append user message, inject stage_instructions, call AI, append response
- [ ] 5.8 Update `execution_state` based on execution result status (`completed`, `failed`, `waiting_user`, `idle`, etc.)
- [ ] 5.9 Implement retry: create new execution, reset `execution_state` to `running`, increment `retry_count`, re-run prompt
- [ ] 5.10 Handle spawned tasks from execution result: create task records with `created_from_task_id` / `created_from_execution_id`

## 6. Git Worktree

- [ ] 6.1 Implement worktree creation: run `git worktree add` from `git_root_path` with branch `task/<id>-<slug>`
- [ ] 6.2 Track worktree lifecycle in `task_git_context` (`not_created` → `creating` → `ready` / `failed`)
- [ ] 6.3 Trigger worktree creation on first active transition out of Backlog
- [ ] 6.4 Handle creation failure: set `worktree_status` to `failed`, set `execution_state` to `failed`, append error to conversation
- [ ] 6.5 Include `worktree_path`, `project_path`, and `git_root_path` in execution payload when worktree is `ready`
- [ ] 6.6 Respect configurable `worktree_base_path` from `workspace.yaml`

## 7. IPC API (Bun ↔ WebView)

- [ ] 7.1 `workspace.getConfig` — return current workspace and AI provider config
- [ ] 7.2 `boards.list` — return all boards with column definitions
- [ ] 7.3 `boards.create` — create a board with linked projects and workflow template
- [ ] 7.4 `projects.list` — return all registered projects
- [ ] 7.5 `projects.register` — register a folder as a project (validate `project_path` and `git_root_path`)
- [ ] 7.6 `tasks.list` — return tasks for a board with workflow + execution state
- [ ] 7.7 `tasks.create` — create a task under a board + project
- [ ] 7.8 `tasks.transition` — move task to new workflow state (triggers execution if prompt configured)
- [ ] 7.9 `tasks.retry` — retry execution in current column
- [ ] 7.10 `tasks.sendMessage` — append user message and trigger AI response (human turn)
- [ ] 7.11 `conversations.getMessages` — return full message timeline for a task
- [ ] 7.12 Streaming IPC: push AI tokens to WebView in real time as they arrive

## 8. Board UI

- [ ] 8.1 Implement board list / selection screen
- [ ] 8.2 Implement board view with columns rendered from workflow template config
- [ ] 8.3 Implement task cards showing title, project badge, and execution state badge
- [ ] 8.4 Implement task transition via drag-and-drop or column move button using PrimeVue
- [ ] 8.5 Update task card execution state badge reactively without page reload

## 9. Task Detail View

- [ ] 9.1 Implement task detail panel / drawer with header (title, board, project, workflow state, execution state)
- [ ] 9.2 Implement conversation timeline rendering all message types (`user`, `assistant`, `system`, `tool_call`, `tool_result`, `transition_event`)
- [ ] 9.3 Implement real-time streaming display: show tokens as they arrive in the timeline
- [ ] 9.4 Implement human chat input: text field that sends a message and triggers AI response
- [ ] 9.5 Implement retry button: visible when execution state is `failed` or `waiting_user`
- [ ] 9.6 Implement side panel: task metadata, worktree info, current execution status, spawned tasks

## 10. Project & Workspace Setup UI

- [ ] 10.1 Implement project registration form (folder picker, name, `project_path`, `git_root_path`, `default_branch`)
- [ ] 10.2 Implement workspace settings screen (AI provider config: base URL, API key, model)
- [ ] 10.3 Implement first-run onboarding: guide user to configure workspace and register first project

## 11. Fake AI & Local Testing

- [ ] 11.1 Implement a `FakeAIProvider` that returns a scripted streamed response after a configurable delay
- [ ] 11.2 Add a config flag (`ai.provider: fake`) to use the fake provider for UI development
- [ ] 11.3 Verify the full board → transition → streaming chat → retry loop using fake AI before wiring real provider
