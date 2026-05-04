# Move Model to Conversation Table - Task Checklist

## 1. Database Migration
- [x] 1.1 Add `model TEXT` column to `conversations` table
- [x] 1.2 Migrate existing data from `tasks.model` to `conversations.model`
- [x] 1.3 Remove `model` column from `tasks` table (after verifying migration success)

## 2. Task Creation Fix
- [x] 2.1 Update `tasks.create` handler in `src/bun/handlers/tasks.ts` to seed `conversation.model` instead of `tasks.model`
- [x] 2.2 Set conversation.model = workspace.default_model || engine.model || null
- [x] 2.3 Update conversation's task_id after task creation
- [x] 2.4 Implemented `seedConversationModel()` function in `model-resolver.ts`
- [x] 2.5 Removed "auto" fallback (using null instead, "auto" descoped)

## 3. Chat Session Creation Fix
- [x] 3.1 Update `chatSessions.create` handler in `src/bun/handlers/chat-sessions.ts` to seed `conversation.model`
- [x] 3.2 Set conversation.model = workspace.default_model || engine.model || null
- [x] 3.3 Link chat session to conversation with task_id = NULL

## 4. Model Selection Handler Updates
- [x] 4.1 Update `tasks.setModel` handler in `src/bun/handlers/tasks.ts` to update `conversations.model`
- [x] 4.2 Update frontend task store to use the updated API
- [x] 4.3 Add model selection event handling in TaskChatView
- [x] 4.4 **DESCOPED**: "auto" model value support (using null instead)

## 5. Column Transition Logic
- [x] 5.1 Update `TransitionExecutor` in `src/bun/engine/execution/transition-executor.ts`
- [x] 5.2 Get task's conversation via task.conversation_id
- [x] 5.3 If column has model defined: update conversation.model = column.model
- [x] 5.4 Use simplified model resolution with explicit column transition context
- [x] 5.5 **DESCOPED**: prepareModelForEngine() call (not needed with null approach)
- [x] 5.6 Else: leave conversation.model unchanged (preserve user selection)
- [x] 5.7 Update to use simplified resolution function with isColumnTransition context
- [x] 5.8 Centralized model resolution in `resolveModel()` function

## 6. Executor Updates
- [x] 6.1 Update all executors (HumanTurnExecutor, RetryExecutor, etc.) to:
- [x] 6.2 Get conversation model from the appropriate conversation
- [x] 6.3 Apply simplified model resolution logic
- [x] 6.4 Remove direct tasks.model references
- [x] 6.5 Update all executors to use new resolveModel() function with context
- [x] 6.6 Applied to TransitionExecutor, RetryExecutor, and HumanTurnExecutor

## 7. Simplified Model Resolver
- [x] 7.1 Create simplified `resolveModel()` function with isColumnTransition context
- [x] 7.2 Update all executor calls to use new function signature
- [x] 7.3 Remove engine default fallback logic from executors
- [x] 7.4 Update model-resolver.ts with corrected documentation
- [x] 7.5 Implemented `seedConversationModel()` for automatic model seeding

## 8. "Auto" Model Implementation
- [x] 8.1 **DESCOPED**: "auto" as explicit model option in UI (using null instead)
- [x] 8.2 **DESCOPED**: Backend "auto" → "" translation for engines (not needed)
- [x] 8.3 **DESCOPED**: Database migration for null → "auto" (not needed)
- [x] 8.4 **DESCOPED**: "auto" as clean abstraction (violates design principles - rejected in design.md)

## 9. Cleanup and Consistency
- [x] 9.1 Update remaining references to tasks.model in the codebase
- [x] 9.2 Update tests that reference tasks.model
- [x] 9.3 Verify all execution paths use the new model location
- [x] 9.4 Create specs for model-selection reflecting the new conversation.model location
- [x] 9.5 Update OpenSpec documents with simplified architecture (this file)
- [x] 9.6 Run existing tests to ensure no regressions
- [x] 9.7 Remove deprecated resolveTaskModel() function (not found - already cleaned up)
