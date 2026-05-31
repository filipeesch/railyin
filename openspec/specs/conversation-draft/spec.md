# Spec: Conversation Draft Persistence

## Overview

Requirements for persisting unsent message drafts in the conversation input across navigation, drawer toggles, and page reloads.

## Requirements

### Requirement: Conversation input draft is persisted per task and per session
The system SHALL persist the text entered in the conversation input for each task and each chat session to `localStorage`, keyed by a namespaced identifier, so that the draft survives tab switches, drawer close/reopen, and page reload.

#### Scenario: Draft survives switching to a different drawer tab
- **WHEN** a user has typed text in the conversation input and switches to a different drawer tab (e.g., info, git, decisions, notes)
- **THEN** the typed text is still present in the conversation input when the user returns to the chat tab

#### Scenario: Draft survives closing and reopening the drawer
- **WHEN** a user has typed text in the conversation input and closes the task or session drawer
- **THEN** the typed text is restored in the conversation input when the user reopens the same task or session drawer

#### Scenario: Draft survives page reload
- **WHEN** a user has typed text in the conversation input and reloads the page
- **THEN** the typed text is restored in the conversation input when the user opens the same task or session

### Requirement: Draft is cleared when the message is sent
The system SHALL remove the persisted draft for a task or session immediately after the user sends a message, so that the input starts empty for the next message.

#### Scenario: Draft cleared on successful send
- **WHEN** a user sends a message from the conversation input
- **THEN** the draft entry for that task or session is deleted and the input is empty

### Requirement: Draft is cleared when the entity is deleted
The system SHALL remove the persisted draft for a task or session when that task or session is deleted.

#### Scenario: Draft cleared on task deletion
- **WHEN** a task is deleted
- **THEN** the draft entry for that task is removed from localStorage

#### Scenario: Draft cleared on session deletion
- **WHEN** a chat session is deleted
- **THEN** the draft entry for that session is removed from localStorage

### Requirement: Stale draft entries are evicted after 7 days
The system SHALL automatically remove draft localStorage entries that are older than 7 days on application init, so that storage does not grow unboundedly.

#### Scenario: Stale draft evicted at startup
- **WHEN** the application loads and a draft entry's saved timestamp is older than 7 days
- **THEN** that entry is removed from localStorage during draft store initialization
