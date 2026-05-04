# Move Model Column to Conversations Table

## Problem Statement
Currently, the AI model selection is stored in the `tasks.model` column. This creates two issues:
1. Task chat model selection doesn't persist across turns - it resets to workspace/default model every turn
2. Chat sessions don't use the workspace default model as their default and have the same persistence issue

The root cause is that model storage is fragmented: tasks have a model column, but chat sessions don't, leading to inconsistent behavior between task chats and chat sessions.

## Proposed Solution
Move the `model` column from the `tasks` table to the `conversations` table. This creates a single source of truth for the AI model used in a conversation, shared between:
- Task chats: The conversation linked to the task
- Chat sessions: The standalone conversation for the session

## Benefits
1. **Unified model storage**: One place to store the model for a conversation
2. **Eliminates persistence issues**: Model selection naturally persists as part of the conversation
3. **Consistent behavior**: Task chats and chat sessions use the same model resolution logic
4. **Simpler mental model**: The model is a property of the conversation (where chat messages live)
5. **Reduces complexity**: No need to sync model between task and conversation tables

## How It Works
- **Task creation**: When creating a task, also set the model on the linked conversation
- **Chat session creation**: When creating a chat session, set the model on its conversation
- **User model selection**: When user changes model in UI, update the conversation's model column
- **Column transitions**: If moving to a column with a defined model, update the conversation's model; otherwise preserve the existing conversation model
- **Execution**: Retrieve model from the conversation (with column override logic for task chats)

## Implementation Approach
1. Add `model TEXT` column to `conversations` table
2. Migrate existing data from `tasks.model` to `conversations.model`
3. Remove `model` column from `tasks` table
4. Update all code that reads/writes `tasks.model` to use `conversations.model` instead
5. Update task and chat session creation to seed the conversation model
6. Update column transition logic to conditionally update conversation model