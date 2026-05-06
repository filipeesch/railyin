## ADDED Requirements

### Requirement: ContentHashCache unit test coverage
The test suite SHALL cover all `ContentHashCache` behavioral contracts at the unit level in `src/bun/test/pi-hash-cache.test.ts`. Tests instantiate `ContentHashCache` directly with no I/O.

#### Scenario: HC-1 First read caches hash and returns content
- **WHEN** `read_file` is called for a path not yet in the cache
- **THEN** `check(path, hash)` returns `{ hit: false }` and `record(path, hash, turnN)` stores the entry

#### Scenario: HC-2 Repeat read with same hash and seenInWindow=true returns hit
- **WHEN** `check(path, sameHash)` is called after `record(path, sameHash, turnN)` with `seenInWindow=true`
- **THEN** `check` returns `{ hit: true, turnNumber: N }`

#### Scenario: HC-3 Changed hash returns miss
- **WHEN** `check(path, newHash)` is called and cached hash differs
- **THEN** `check` returns `{ hit: false }`

#### Scenario: HC-4 Write invalidation clears entry
- **WHEN** `invalidate(path)` is called
- **THEN** `check(path, anyHash)` returns `{ hit: false }`

#### Scenario: HC-5 Compaction reset clears seenInWindow but preserves hash
- **WHEN** `resetWindow()` is called
- **THEN** all entries have `seenInWindow = false`
- **AND** hash values are unchanged
- **AND** next `check` for any path returns `{ hit: false }` (seenInWindow guard)

#### Scenario: HC-6 Post-compaction read re-sets seenInWindow
- **WHEN** `check` returns miss after `resetWindow()` and `record` is called again
- **THEN** `seenInWindow` is `true` and `check` returns hit on next call

#### Scenario: HC-7 Search cache deduplication
- **WHEN** `checkSearch(key)` is called with same composite key and no intervening invalidation
- **THEN** returns `{ hit: true, turnNumber: N, matchCount: M }`

#### Scenario: HC-8 Glob-based search invalidation via picomatch
- **WHEN** `invalidateGlob("src/**/*.ts")` is called and a search entry has glob scope `"src/**/*.ts"`
- **THEN** that search entry is removed from the cache
- **AND** search entries with non-matching globs are unaffected
