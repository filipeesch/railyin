---
description: Investigate an issue or question by gathering information, analyzing data, and generating insights.
---

Investigate the given issue or question by gathering relevant information, analyzing data, and generating insights. Look at logs, code, documentation, and any other relevant sources to understand the problem deeply. Identify patterns, root causes, and potential solutions. Use diagrams or tables if they help clarify complex information.

Don't change my code or files without my explicit instruction!

---

## Railyin investigation quick-reference

### Database

- **Location:** `~/.railyn/railyn.db` (override with `RAILYN_DB` env var; `:memory:` in tests)
- **Schema:** `src/bun/db/migrations.ts` | **Row types:** `src/bun/db/row-types.ts`
- **Open interactively:** `sqlite3 ~/.railyn/railyn.db`

**Key tables:**

| Table | Purpose |
|---|---|
| `tasks` | Main task rows — `id, board_id, title, workflow_state, execution_state, conversation_id, model` |
| `conversations` | One row per task — `id, task_id` |
| `conversation_messages` | All chat turns — `id, task_id, conversation_id, type, role, content, metadata, created_at` |
| `executions` | Run history — `id, task_id, status, attempt, started_at, finished_at, summary, details` |
| `logs` | App logs — `id, level, task_id, execution_id, message, data, created_at` |
| `task_git_context` | Worktree state — `task_id, branch_name, worktree_path, worktree_status` |
| `task_todos` | Sub-todos — `id, task_id, title, status, result` |
| `pending_messages` | Queued user messages — `id, task_id, content` |

**Commonly useful queries:**

```sql
-- 1. Discover the task by name fragment (start here when given a task name)
SELECT id, title, workflow_state, execution_state, created_at FROM tasks WHERE title LIKE '%<fragment>%' ORDER BY created_at DESC;

-- 2. Recent tasks (fallback when no name is given)
SELECT id, title, workflow_state, execution_state, created_at FROM tasks ORDER BY created_at DESC LIMIT 20;

-- 3. All messages for the discovered task
SELECT role, type, content, created_at FROM conversation_messages WHERE task_id = (SELECT id FROM tasks WHERE title LIKE '%<fragment>%' ORDER BY created_at DESC LIMIT 1) ORDER BY created_at ASC;

-- 4. Execution history for the discovered task
SELECT id, status, attempt, started_at, finished_at, summary FROM executions WHERE task_id = (SELECT id FROM tasks WHERE title LIKE '%<fragment>%' ORDER BY created_at DESC LIMIT 1) ORDER BY started_at DESC;

-- 5. Logs for the discovered task
SELECT level, message, data, created_at FROM logs WHERE task_id = (SELECT id FROM tasks WHERE title LIKE '%<fragment>%' ORDER BY created_at DESC LIMIT 1) ORDER BY id ASC;

-- 6. Recent errors/warnings across all tasks
SELECT task_id, level, message, data, created_at FROM logs WHERE level IN ('error', 'warn') ORDER BY created_at DESC LIMIT 50;

-- 7. Worktrees with non-ready status
SELECT task_id, worktree_status, branch_name, worktree_path FROM task_git_context WHERE worktree_status != 'ready';
```

### Logs

Logs are written both to **stdout** and the **`logs` SQLite table** (see `src/bun/logger.ts`).  
Levels: `debug`, `info`, `warn`, `error`.

### Debug CLI (requires app running)

```bash
# WebView inspector — debug HTTP server must be on http://localhost:9229
bun src/debug-cli.ts find ".selector"
bun src/debug-cli.ts screenshot          # saves to /tmp/railyn-debug-*.png
bun src/debug-cli.ts eval "return document.title"
bun src/debug-cli.ts vue                 # dump Vue component tree
bun src/debug-cli.ts store               # dump Pinia store state
bun src/debug-cli.ts logs               # recent debug log events
```

Full command list: `src/debug-cli.ts` (find, all, nth, count, styles, rect, click, eval, logs, buttons, snapshot, waitfor, vue, store, screenshot, hunkdiag…).

### Key source locations

| Area | File |
|---|---|
| DB connection & setup | `src/bun/db/index.ts` |
| All migrations / schema | `src/bun/db/migrations.ts` |
| Workflow engine (main loop) | `src/bun/workflow/engine.ts` |
| AI provider (Anthropic) | `src/bun/ai/anthropic.ts` |
| Tool definitions | `src/bun/workflow/tools.ts` |
| RPC handlers — tasks | `src/bun/handlers/tasks.ts` |
| RPC handlers — conversations | `src/bun/handlers/conversations.ts` |
| Logger | `src/bun/logger.ts` |