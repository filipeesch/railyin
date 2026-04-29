## ADDED Requirements

### Requirement: MW-1 `createMockWait()` returns `waitFn` + `tick`
`createMockWait()` returns an object `{ waitFn, tick }` where `waitFn` conforms to `WaitFn = (ms: number) => Promise<void>`.

#### Scenario: waitFn does not resolve until tick is called
- **WHEN** `waitFn(500)` is called
- **THEN** the returned promise is pending until `tick()` is called

#### Scenario: tick resolves the pending promise
- **WHEN** `tick()` is called after `waitFn()` is awaited
- **THEN** the promise resolves immediately

### Requirement: MW-2 Sequential calls — each `tick` resolves one pending wait
Each `waitFn()` invocation creates a new pending promise. Calling `tick()` resolves only the currently-awaited promise.

#### Scenario: Second wait starts fresh after first resolves
- **WHEN** `waitFn()` is called twice (second call starts after first resolves via `tick()`)
- **THEN** the second promise is pending until a second `tick()` is called
