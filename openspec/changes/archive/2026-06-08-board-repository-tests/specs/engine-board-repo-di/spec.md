# Engine Board Repository DI

## Purpose

DI contract tests verifying all 4 engines accept `IBoardRepository` and use it for workspace key resolution.

## Requirements

### Requirement: ER-DI-5 ClaudeEngine accepts IBoardRepository
The test suite SHALL verify that `ClaudeEngine` constructor accepts `IBoardRepository` as a required parameter.

#### Scenario: ER-DI-5.1 Constructor accepts boardRepo
- **WHEN** `new ClaudeEngine(..., boardRepo)` is called with a mock `IBoardRepository`
- **THEN** the engine is constructed without errors and stores the repository

#### Scenario: ER-DI-5.2 listCommands uses boardRepo
- **WHEN** `ClaudeEngine.listCommands(taskId)` is called
- **AND** a mock `IBoardRepository` is injected
- **THEN** `mockBoardRepo.getWorkspaceKey(boardId)` is called instead of a direct DB query

### Requirement: ER-DI-6 CopilotEngine accepts IBoardRepository
The test suite SHALL verify that `CopilotEngine` constructor accepts `IBoardRepository` as a required parameter.

#### Scenario: ER-DI-6.1 Constructor accepts boardRepo
- **WHEN** `new CopilotEngine(..., boardRepo)` is called with a mock `IBoardRepository`
- **THEN** the engine is constructed without errors and stores the repository

### Requirement: ER-DI-7 PiEngine accepts IBoardRepository
The test suite SHALL verify that `PiEngine` constructor accepts `IBoardRepository` as a required parameter.

#### Scenario: ER-DI-7.1 Constructor accepts boardRepo
- **WHEN** `new PiEngine(..., boardRepo)` is called with a mock `IBoardRepository`
- **THEN** the engine is constructed without errors and stores the repository

### Requirement: ER-DI-8 OpenCodeEngine accepts IBoardRepository
The test suite SHALL verify that `OpenCodeEngine` constructor accepts `IBoardRepository` as a required parameter.

#### Scenario: ER-DI-8.1 Constructor accepts boardRepo
- **WHEN** `new OpenCodeEngine(..., boardRepo)` is called with a mock `IBoardRepository`
- **THEN** the engine is constructed without errors and stores the repository

### Requirement: LC-1 Engine listCommands uses BoardRepository
The test suite SHALL verify that engine `listCommands` methods use `BoardRepository.getWorkspaceKey` instead of direct DB queries.

#### Scenario: LC-1.1 ClaudeEngine.listCommands delegates to boardRepo
- **WHEN** `ClaudeEngine.listCommands(taskId)` is called
- **AND** a mock `IBoardRepository` is injected
- **THEN** `mockBoardRepo.getWorkspaceKey(task.boardId)` is called exactly once
