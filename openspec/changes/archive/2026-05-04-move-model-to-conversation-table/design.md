# Move Model Column to Conversations Table - Design

## Context
Currently, the `tasks` table has a `model` column that stores the AI model selected for a task. Chat sessions (stored in `chat_sessions` table) do not have a model column, leading to inconsistent behavior:
- Task chats: Model selection doesn't persist well across turns
- Chat sessions: Don't default to workspace model and have persistence issues

Both task chats and chat sessions are linked to conversations:
- Task chats: `tasks.conversation_id` → `conversations.id`
- Chat sessions: `chat_sessions.conversation_id` → `conversations.id`

## Proposed Changes
Move the `model` column from `tasks` table to `conversations` table to create a single source of truth for the AI model used in a conversation.

## Detailed Design

### 1. Schema Changes
**Add model column to conversations table:**
```sql
ALTER TABLE conversations ADD COLUMN model TEXT;
```

**Migrate existing data:**
```sql
UPDATE conversations 
SET model = (SELECT model FROM tasks WHERE tasks.conversation_id = conversations.id)
WHERE EXISTS (SELECT 1 FROM tasks WHERE tasks.conversation_id = conversations.id);
```

**Remove model column from tasks table (after migration):**
```sql
ALTER TABLE tasks DROP COLUMN model;
```

### 2. Simplified Model Resolution Logic

**Core Principle:** Conversation model is the single source of truth, except during column transitions.

#### Model Resolution Rules:

1. **At Creation Time (Tasks and Chat Sessions):**
   ```
   conversation.model = workspace.default_model || engine.model || "auto"
   ```
   - Workspace default model is used if configured
   - Otherwise fall back to engine model
   - Otherwise default to "auto" (special value for Copilot auto-selection)

2. **During Column Transitions:**
   ```
   IF column.model IS defined:
       conversation.model = column.model  (overrides existing value)
   ELSE:
       conversation.model unchanged  (preserves user's selection)
   ```
   - Column model ONLY overrides if explicitly defined in workflow YAML
   - If column has no model defined, user's conversation model is preserved
   - No fallback to workspace/engine defaults during transitions

3. **All Other Scenarios (Normal Execution, Retry, etc.):**
   ```
   effective_model = conversation.model
   ```
   - Always use conversation.model as-is
   - No fallback to workspace/engine defaults
   - Empty string or "auto" are valid conversation model values

#### Special "auto" Model Value:
- "auto" is an explicit model value (not NULL)
- Stored directly in conversation.model
- Backend translates "auto" → "" when sending to engines
- UI displays "Auto" but stores "auto" in database

### 3. Benefits of Simplified Approach

1. **Clear Ownership:** Conversation model is the single source of truth
2. **Predictable Behavior:** No complex fallback chains
3. **Explicit Auto:** "auto" is a first-class model value, not magic NULL
4. **User Control:** Column transitions preserve user choices when column has no model
5. **Easier Debugging:** Simple, consistent rules across all scenarios

### 3. Code Changes

#### Task Creation (`src/bun/handlers/tasks.ts`)
- After creating conversation with `task_id = 0`, set `conversation.model = workspace.default_model || engine.model || null`
- Update conversation's `task_id` to the new task's ID
- No longer set `tasks.model` (column removed)

#### Chat Session Creation (`src/bun/handlers/chat-sessions.ts`)
- After creating conversation with `task_id = NULL`, set `conversation.model = workspace.default_model || engine.model || null`
- Link chat session to this conversation

#### User Model Selection
- Update `tasks.setModel` handler to update `conversations.model` instead of `tasks.model`
- Update frontend store to call the updated API

#### Column Transition (`src/bun/engine/execution/transition-executor.ts`)
- Get the task's conversation
- If column has model defined: update `conversation.model = column.model`
- Else: leave `conversation.model` unchanged (preserves user selection)

#### Execution (All Executors)
- For task chats: Get conversation via `task.conversation_id`
- For chat sessions: Get conversation via `chat_session.conversation_id`
- Apply model resolution logic:
  ```
  if (task exists && column.model is defined) {
      return column.model;
  }
  return conversation.model || engine.model || "";
  ```

### 4. Fallback Handling
- Empty strings and NULL are treated equivalently as "not set"
- The resolution chain uses `||` logic so empty strings fall through to the next option
- This matches the existing `resolveTaskModel` behavior but adapted for the new schema

## Impact
- **Database**: One-time migration to move model data from tasks to conversations
- **API**: No changes needed - the model value is still accessible via the same paths
- **UI**: No changes needed - model selection UI continues to work as before
- **Behavior**: 
  - Task chat model selection now persists across turns
  - Chat sessions now default to and persist workspace/engine model
  - Column transition behavior unchanged (respects column model when set)

## Relationship to Existing Code
This change builds upon the existing `resolveTaskModel` pattern but changes where the "task.model" is stored (now in conversations.model). The core logic remains the same, just shifted to a more centralized location.