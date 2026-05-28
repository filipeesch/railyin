# Async Worktree Test Suite — Specs

## Unit: `prepareAndExecute()` callback behavior

### Requirement: Worktree creates successfully → callback.onPrepared() fires
- **WHEN** `prepareAndExecute()` creates worktree successfully
- **THEN** `callback.onPrepared(taskId, {path, branch})` is called
- **AND** worktreeStatus is updated to `"ready"`

#### Scenario: Worktree successful creation
- **GIVEN** task has no worktree (status = idle)
- **WHEN** `prepareAndExecute(taskId, callback)` is called
- **THEN** worktree is created in background
- **AND** `callback.onPrepared()` fires with worktree path and branch
- **AND** worktreeStatus becomes `"ready"`

### Requirement: Worktree creation fails → callback.onFailed() fires
- **WHEN** `prepareAndExecute()` fails to create worktree
- **THEN** `callback.onFailed(taskId, error)` is called
- **AND** worktreeStatus is updated to `"failed"`

#### Scenario: Worktree creation failure
- **GIVEN** git worktree command fails
- **WHEN** `prepareAndExecute(taskId, callback)` is called
- **THEN** `callback.onFailed()` fires with error details
- **AND** worktreeStatus becomes `"failed"`
- **AND** UI shows worktree creation error

### Requirement: Concurrent calls are idempotent
- **WHEN** `prepareAndExecute()` is called concurrently for the same task
- **THEN** Only one worktree creation happens
- **AND** Subsequent calls return immediately with no-op

#### Scenario: Concurrent `prepareAndExecute()` calls
- **GIVEN** task has no worktree (status = idle)
- **WHEN** two `prepareAndExecute()` calls fire simultaneously
- **THEN** Only one worktree creation is triggered
- **AND** Second call returns immediately (no-op)
- **AND** Only one `callback.onPrepared()` fires

### Requirement: Already-ready worktree → no-op
- **WHEN** worktree already exists (status = ready)
- **THEN** `prepareAndExecute()` does nothing
- **AND** Returns immediately

#### Scenario: Worktree already ready
- **GIVEN** Task has `worktreeStatus = "ready"`
- **WHEN** `prepareAndExecute(taskId, callback)` is called
- **THEN** No worktree is created
- **AND** Return value is `{status: "ready", ...}`

### Requirement: Server restart recovers worktree
- **WHEN** Server restarts with worktree invalid
- **THEN** Background task resumes worktree creation
- **AND** `worktreeStatus` transitions `"invalid"` → `"ready"`

#### Scenario: Server restarts mid-preparation
- **GIVEN** `task has worktreeStatus = "invalid"` (stuck from restart)
- **WHEN** `prepareAndExecute(taskId, callback)` runs
- **THEN** Invalid worktree is recreated
- **AND** `callback.onPrepared()` fires
- **AND** `worktreeStatus` becomes `"ready"`

### Requirement: Task deletion cancels in-flight preparation
- **WHEN** Task is deleted during async preparation
- **THEN** In-flight preparation is cancelled
- **AND** no dangling worktree state remains

#### Scenario: Task deleted during preparation
- **GIVEN** `prepareAndExecute()` is running
- **WHEN** `DB.deleteTask(taskId)` is called
- **THEN** In-flight worktree creation is cancelled
- **AND** Task state cleared to `"removed"`

### Requirement: Timeout protection — "preparing" → "failed" after configurable timeout
- **WHEN** `prepareAndExecute()` exceeds timeout
- **THEN** Task auto-transitions to `"failed"`

#### Scenario: Timeout exceeded
- **GIVEN** Timeout = 60s configured
- **WHEN** `prepareAndExecute()` takes >60s
- **THEN** Task state changes to `"failed"`
- **AND** Error message indicates preparation timeout

---

## Integration: Handler behavior with async worktree

### Requirement: tasks.transition returns immediately while in "preparing"
- **WHEN** `tasks.transition` is called
- **THEN** RPC response returned before worktree is ready
- **AND** Tasks state is `"preparing"`

#### Scenario: RPC returns immediately
- **GIVEN** task transitions to column with `onEnter_prompt` + worktree needed
- **WHEN** tasks.transition call received
- **THEN** Returns within ≤1 second
- **AND** task.execution_state becomes `"preparing"`
- **AND** Background worktree starts immediately

### Requirement: tasks.retry returns immediately while in "preparing"
- **WHEN** `tasks.retry` is called
- **THEN** RPC response returned before worktree is ready
- **AND** Tasks state is `"preparing"`

#### Scenario: Retry.async return
- **GIVEN** `tasks.retry` triggered with `"preparing"` task
- **WHEN** Retry RPC called
- **THEN** Returns within ≤1 second
- **AND** task.execution_state becomes `"preparing"` again

### Requirement: Worktree creation succeeds → auto-triggers execution + streaming
- **WHEN** worktree preparation succeeds
- **THEN** Execution engine starts automatically
- **AND** Matrix Starts streaming

#### Scenario: Success → execution starts
- **GIVEN** `prepareAndExecute()` completed
- **THEN** Engine execution starts
- **AND** Streaming begins

### Requirement: Worktree creation fails → task becomes "failed", error shown
- **WHEN** worktree creation fails
- **THEN** Task becomes `"failed"`
- **AND** Error message is pushed

#### Scenario: Worktree failure
- **GIVEN** task in `"preparing"`
- **WHEN** worktree creation fails
- **THEN** Task execution_state = `"failed"`
- **AND** Error message pushed via WebSocket

### Requirement: WebSocket push carries correct state throughout ("preparing" → "running")
- **WHEN** task transitions through states
- **THEN** WebSocket push events carry correct state
- **AND** Updates are accurate

#### Scenario: Push event accuracy
- **GIVEN** task executes state = `"preparing"`
- **WHEN** worktree ready → execution starts
- **THEN** Push event shows `"preparing"`
- **AND** Subsequent push event shows `"running"`
- **AND** State match latest queries

### Requirement: State machine transitions work correctly ("preparing" → "running" / "failed")
- **WHEN** task is in `"preparing"` state
- **THEN** `tasks.transition()` correctly transitions to `"running"` or `"failed"`
- **AND** State machine validates transitions

#### Scenario: State machine validates transitions
- **GIVEN** task.execution_state = `"preparing"`
- **WHEN** `tasks.retry()` called → status: `"failed"`
- **THEN** Task auto-transitions to `"idle"`
- **AND** Worktree is recreated

---

## E2E UI: Playwright `async-worktree-preparation` spec

### Requirement: Drag task to column with `onEnter_prompt` → shows "preparing" badge
- **WHEN** user drags task to column with `onEnter_prompt`
- **THEN** `"preparing"` badge appears in UI
- **AND** Badge includes task ID + column ID

#### Scenario: UI shows preparing badge
- **GIVEN** Board has column with `onEnter_prompt` and worktree required
- **WHEN** user drags task to that column (or triggers auto-column transition)
- **THEN** `"preparing"` badge appears
- **AND** Badge color indicates preparation status
- **AND** Spinner animation starts (user sees progress)

### Requirement: "preparing" badge → "running" transition
- **WHEN** worktree preparation succeeds
- **THEN** `"preparing"` badge disappears
- **AND** Streaming starts

#### Scenario: Badge transitions to streaming
- **GIVEN** UI shows `"preparing"` badge
- **WHEN** execution engine starts streaming
- **THEN** `"preparing"` badge disappears
- **AND** Running status shown
- **AND** Streaming UI renders correctly

### Requirement: Worktree creates successfully → UI updates badge
- **WHEN** worktree completes creation
- **THEN** UI badge updates to show exact worktree path
- **AND** Badge disappears when streaming starts

#### Scenario: Success update
- **GIVEN** UI shows `"preparing"`
- **THEN** badge changes work info
- **AND** badge disappears when streaming starts

### Requirement: Worktree fails → error badge shown
- **WHEN** worktree creation fails
- **THEN** Error badge displayed
- **AND** Shows "Worktree failed" message

#### Scenario: Worktree creation fails → error badge shown
- **GIVEN** UI shows `"preparing"`
- **WHEN** worktree creation fails
- **THEN** Error badge displayed
- **AND** Shows "Worktree creation failed"
- **AND** Error badge is dismissable (click X)

### Requirement: Retry cycle works — click retry → worktree re-creates → streaming starts
- **WHEN** worktree preparation fails
- **THEN** Error badge shown
- **AND** Click retry button
- **THEN** Worktree re-creates → streaming starts

#### Scenario: Retry flow
- **GIVEN** UI shows error badge after worktree failure
- **WHEN** Click retry button
- **THEN** Worktree attempts preparation
- **THEN** Streaming starts

### Requirement: Deleted task during preparation → cancelled gracefully
- **WHEN** task is deleted during worktree preparation
- **THEN** Preparation cancelled
- **AND** UI updates to show task is gone

#### Scenario: Deleted task during preparation
- **GIVEN** task being prepared
- **WHEN** task is deleted (user action or auto-disable)
- **THEN** Preparation immediately cancelled
- **AND** Task removed from UI

### Requirement: `ApiMock` for `"preparing"` state in `e2e/ui/fixtures/mock-api.ts`
- **WHEN** ApiMock receives request
- **THEN** Mock can simulate async worktree preparation

#### Scenario: ApiMock supports "preparing"
- **GIVEN** `ApiMock` for simulate `"preparing"`
- **WHEN** `handleTask` + worktree` call received
- **THEN** Mock returns task state = "preparing"
- **AND** Simulates delay
- **AND** Event simulates worktree ready
- **AND** then simulation of streaming

### Requirement: WebSocket push event simulation for `"preparing"` → `"running"` → `"failed"`
- **WHEN** API returns tasks + worktree
- **THEN** State updates are notified

#### Scenario: WebSocket state update
- **GIVEN** task `"preparing"`
- **WHEN** worktree ready → execution starts
- **THEN** WebSocket event = task.updated + state = "running"
- **AND** Client updates state
- **AND** streaming starts
