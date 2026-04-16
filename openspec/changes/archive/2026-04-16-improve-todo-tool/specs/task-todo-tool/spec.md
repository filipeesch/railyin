## REMOVED Requirements

### Requirement: Model can create todos
**Reason**: Superseded by `todo-tool-v2` spec. The new `create_todo` requires a `description` field and `number` field; the old optional `context` field is removed.
**Migration**: Use `create_todo` with `number`, `title`, and `description` fields. The `context` parameter is no longer accepted.

### Requirement: Model can retrieve a todo by id
**Reason**: Superseded by `todo-tool-v2` spec. The `get_todo` tool now returns `number` and `description` instead of `context` and `result`.
**Migration**: Use `get_todo` — same tool name, updated response shape.

### Requirement: Model can update a todo
**Reason**: Superseded by `todo-tool-v2` spec. `update_todo` is replaced by `edit_todo`. Status values changed.
**Migration**: Use `edit_todo` with the new status vocabulary: `pending`/`in-progress`/`done`/`blocked`/`deleted`.

### Requirement: Model can delete a todo
**Reason**: Superseded by `todo-tool-v2` spec. `delete_todo` now performs a soft-delete (status=deleted) rather than a hard DELETE.
**Migration**: Behavior is the same from the model's perspective — call `delete_todo(id)` to remove a todo from the list.

### Requirement: Model can list todos
**Reason**: Superseded by `todo-tool-v2` spec. `list_todos` now returns `number` in addition to `id` and `title`; `status` is excluded from the list response.
**Migration**: Use `list_todos` — same tool name, response now includes `number` field.
