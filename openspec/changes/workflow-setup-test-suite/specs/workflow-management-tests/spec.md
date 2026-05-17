## ADDED Requirements

### Requirement: workflow.list guard metadata is handler-tested
The test suite SHALL cover the `workflow.list` handler with an in-memory database and boards created through `boardHandlers`.

#### Scenario: list returns every workspace workflow
- **WHEN** `workflow.list` is called for a workspace with multiple workflow files
- **THEN** every workflow is returned with its id and name

#### Scenario: boardCount reflects referencing boards
- **WHEN** boards reference a given workflow template
- **THEN** that workflow's `boardCount` in the `workflow.list` response equals the number of referencing boards

#### Scenario: A referenced workflow is reported not deletable
- **WHEN** a workflow is referenced by at least one board
- **THEN** its `workflow.list` entry has `deletable` false and a non-null `undeletableReason`

#### Scenario: The sole workflow is reported not deletable
- **WHEN** only one workflow exists in the workspace
- **THEN** its `workflow.list` entry has `deletable` false and a non-null `undeletableReason`

#### Scenario: A free workflow is reported deletable
- **WHEN** a workflow has no referencing boards and is not the only workflow
- **THEN** its `workflow.list` entry has `deletable` true

### Requirement: workflow.create is handler-tested
The test suite SHALL cover the `workflow.create` handler.

#### Scenario: create writes a file and returns the id
- **WHEN** `workflow.create` is called with a name
- **THEN** a new workflow file is written and the response identifies the new id

#### Scenario: created workflow appears in a subsequent list
- **WHEN** `workflow.list` is called after `workflow.create`
- **THEN** the newly created workflow is present in the result

#### Scenario: create notifies the frontend
- **WHEN** `workflow.create` completes successfully
- **THEN** the injected `notifyReloaded` callback is invoked

### Requirement: workflow.delete and server-side guards are handler-tested
The test suite SHALL cover the `workflow.delete` handler, including guard enforcement.

#### Scenario: delete removes a free workflow file
- **WHEN** `workflow.delete` targets a workflow with no referencing boards while other workflows exist
- **THEN** the workflow file is removed from disk and `notifyReloaded` is invoked

#### Scenario: delete is rejected for a referenced workflow
- **WHEN** `workflow.delete` targets a workflow referenced by at least one board
- **THEN** the handler throws and the file is not removed

#### Scenario: delete is rejected for the last workflow
- **WHEN** `workflow.delete` targets the only remaining workflow
- **THEN** the handler throws and the file is not removed

### Requirement: The ghost-workflow regression is handler-tested
The test suite SHALL prove the removed in-memory fallback no longer produces an un-editable workflow.

#### Scenario: getYaml throws for an id with no backing file
- **WHEN** `workflow.getYaml` is called with a template id that has no file on disk
- **THEN** the handler throws a not-found error rather than returning synthesized content

### Requirement: workflow RPCs are smoke-tested against a real server
The test suite SHALL include `e2e/api` tests that exercise the workflow RPCs against a real spawned server, focused on server-side guard enforcement.

#### Scenario: list returns the seeded workflow
- **WHEN** `workflow.list` is requested from the running server
- **THEN** the seeded workflow of the test workspace is returned

#### Scenario: create then list reflects the new workflow
- **WHEN** `workflow.create` is requested and then `workflow.list`
- **THEN** the created workflow appears in the list

#### Scenario: the real server rejects deleting a referenced workflow
- **WHEN** a board is created referencing a workflow and `workflow.delete` is then requested for it
- **THEN** the server responds with an error and the workflow is not removed

#### Scenario: the real server rejects deleting the last workflow
- **WHEN** `workflow.delete` is requested for the only remaining workflow
- **THEN** the server responds with an error and the workflow is not removed
