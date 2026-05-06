## ADDED Requirements

### Requirement: Per-conversation cache
A `ContentHashCache` instance is created per Pi session (per `conversationId`) and destroyed with the session.

#### Scenario: Cache created with session
- **WHEN** a new Pi session is created for a `conversationId`
- **THEN** a fresh `ContentHashCache` is created and attached to that session's `HarnessContext`

### Requirement: File read deduplication
When `read_file` is called, content is suppressed if the file hash and requested range match what was last sent for that path. The cache key is `sha256(fullFileContent)` combined with `(start_line, end_line)`. A full read and a partial read of the same file are tracked as independent cache entries. A file change is always detected even for partial reads, since the full-content hash changes regardless of which range is requested.

#### Scenario: First read returns full content
- **WHEN** `read_file` is called for a path not yet in the cache
- **THEN** the full file content (or requested range) is returned
- **AND** the cache is updated with `{ hash: sha256(fullContent), range: (start_line, end_line), seenInWindow: true, turnNumber: N }`

#### Scenario: Unchanged file with same range returns marker
- **WHEN** `read_file` is called for a path already in the cache with the same full-content hash, same (start_line, end_line), and `seenInWindow: true`
- **THEN** `"[file unchanged since turn N — use your cached version]"` is returned
- **AND** no file I/O is performed beyond the hash check

#### Scenario: Same file different range is a cache miss
- **WHEN** `read_file(path, start_line=1, end_line=50)` is in cache and `read_file(path, start_line=51, end_line=100)` is called
- **THEN** the second call returns content for that range (independent cache entry)

#### Scenario: Changed file returns new content
- **WHEN** `read_file` is called and `sha256(currentContent)` differs from the cached hash
- **THEN** the full new content is returned and the cache entry is updated

### Requirement: Write invalidation
Any write operation on a path invalidates that path's cache entry.

#### Scenario: Cache cleared on write
- **WHEN** `write_file`, `patch_file`, `delete_file`, or `rename_file` is called for a path
- **THEN** the cache entry for that path is deleted
- **AND** the next `read_file` call will return full content

### Requirement: Compaction boundary reset
When Pi compacts the conversation, all cached entries have their `seenInWindow` flag reset so the model receives fresh content on next read (since prior context is no longer in the window).

#### Scenario: seenInWindow reset on compaction
- **WHEN** a `compaction_start` Pi event is received
- **THEN** all cache entries have `seenInWindow` set to `false`
- **AND** hash values are preserved (for external change detection)

#### Scenario: Post-compaction read returns full content
- **WHEN** `read_file` is called after compaction for a path whose hash is unchanged
- **THEN** full content is returned (since `seenInWindow` is false)
- **AND** `seenInWindow` is set back to `true`

### Requirement: Search result deduplication
`search_text` results are cached by a composite key of `(pattern, glob, contextLines, globScopeHash)`.

#### Scenario: Unchanged search returns marker
- **WHEN** `search_text` is called with the same parameters and no matching files have changed
- **THEN** `"[search unchanged — N matches, same as turn M]"` is returned

#### Scenario: Search invalidated on write
- **WHEN** a write occurs to a file within the search's glob scope
- **THEN** all search cache entries whose glob scope includes that path are invalidated
