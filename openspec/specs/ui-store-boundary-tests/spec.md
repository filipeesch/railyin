# Spec: UI Store Boundary Tests

## Overview

Test requirements for verifying Pinia store boundary rules — covering O(1) task lookup, reactive Set mutations, dispatch ordering, and cleanup behavior.

## Requirements

### R1 — Task lookup uses O(1) boardId path

Unit tests MUST verify that `_replaceTask` uses `task.boardId` to directly access `tasksByBoard[boardId]` and that only the correct board is mutated.

### R2 — Reactive Set mutation for unread IDs

Unit tests MUST verify that `markTaskUnread`/`clearTaskUnread` in `task.ts` and `markUnread`/`clearUnread` in `chat.ts` mutate the existing Set in place (same instance reference) without creating a new Set via spread.

### R3 — Multi-store dispatch order is conversation-first

A unit test MUST verify that when `App.vue` dispatches a stream event, `conversationStore.onStreamEvent` is invoked before `taskStore.onTaskStreamEvent` and `chatStore.onChatStreamEvent`.

### R4 — changedFileCounts cleanup on task deletion

A unit test MUST verify that deleting a task removes its entry from `taskStore.changedFileCounts`.

### R5 — Unread session reactive Set mutation

Unit tests MUST verify `chatStore.unreadSessionIds` is the same Set instance after `markUnread` and `clearUnread` calls.
