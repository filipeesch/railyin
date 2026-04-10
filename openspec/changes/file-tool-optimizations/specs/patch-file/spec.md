## REMOVED Requirements

### Requirement: patch_file tool provides 5-mode in-place editing
**Reason**: Replaced entirely by the `edit_file` tool which uses a simpler old_string/new_string model that is battle-tested with Anthropic models.
**Migration**: Use `edit_file` with `old_string`/`new_string`. For `start`/`end` append operations, use `write_file`. For `before`/`after` insert, use `edit_file` with the adjacent text as `old_string` and the combined text as `new_string`.
