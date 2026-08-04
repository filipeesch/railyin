#!/usr/bin/env bash
#
# migrate-sqlite-to-postgres.sh — ad-hoc, one-time data copy from an existing
# SQLite railyn.db into a PostgreSQL database.
#
# This is NOT part of the app and is not run automatically anywhere. It's a
# basic, manual tool for the one-off case of moving existing data when
# switching a deployment from SQLite to PostgreSQL (there is no built-in
# migration path — see openspec/changes/support-postgresql/design.md,
# "Data migration tooling" is explicitly out of scope for the app itself).
#
# Requirements:
#   - The target PostgreSQL database must already have the schema applied
#     (boot the app once with `driver: postgres` in config/database.yaml —
#     that runs the consolidated baseline migration — then stop it before
#     running this script).
#   - The target tables must be EMPTY. This script does not merge or dedupe;
#     it INSERTs everything from SQLite as-is.
#   - `sqlite3` and `psql` CLIs must be on PATH.
#
# Usage:
#   ./scripts/migrate-sqlite-to-postgres.sh <path-to-railyn.db> <postgres-connection-url>
#
# Example:
#   ./scripts/migrate-sqlite-to-postgres.sh ~/.railyn/railyn.db \
#     postgres://railyn:secret@localhost:5432/railyn
#
set -euo pipefail

SQLITE_DB="${1:-}"
PG_URL="${2:-}"

if [[ -z "$SQLITE_DB" || -z "$PG_URL" ]]; then
  echo "Usage: $0 <path-to-railyn.db> <postgres-connection-url>" >&2
  exit 1
fi

if [[ ! -f "$SQLITE_DB" ]]; then
  echo "Error: SQLite database not found at: $SQLITE_DB" >&2
  exit 1
fi

command -v sqlite3 >/dev/null || { echo "Error: sqlite3 CLI not found on PATH" >&2; exit 1; }
command -v psql >/dev/null || { echo "Error: psql CLI not found on PATH" >&2; exit 1; }

# Tables in FK-safe order — must match src/bun/db/migrations-postgres/001_baseline.ts
TABLES=(
  conversations
  boards
  tasks
  executions
  conversation_messages
  decision_batches
  decision_records
  decision_revisions
  task_git_context
  pending_messages
  task_hunk_decisions
  task_line_comments
  task_todos
  model_raw_messages
  task_execution_checkpoints
  chat_sessions
  task_notes
  stream_events
  enabled_models
  model_settings
  conversation_injection_state
  logs
)

echo "SQLite source: $SQLITE_DB"
echo "Postgres target: $PG_URL"
echo
echo "This will INSERT all rows from the tables above into the target"
echo "Postgres database. The target tables are expected to be EMPTY."
read -r -p "Continue? [y/N] " CONFIRM
if [[ "$CONFIRM" != "y" && "$CONFIRM" != "Y" ]]; then
  echo "Aborted."
  exit 1
fi

TMPDIR="$(mktemp -d)"
trap 'rm -rf "$TMPDIR"' EXIT

for table in "${TABLES[@]}"; do
  csv_file="$TMPDIR/$table.csv"

  echo "==> Dumping $table from SQLite..."
  sqlite3 -csv -header "$SQLITE_DB" "SELECT * FROM $table;" > "$csv_file"

  row_count=$(($(wc -l < "$csv_file") - 1))
  if [[ "$row_count" -le 0 ]]; then
    echo "    (empty, skipping)"
    continue
  fi

  echo "==> Loading $row_count row(s) into Postgres.$table..."
  psql "$PG_URL" -v ON_ERROR_STOP=1 -c "\\copy $table FROM '$csv_file' WITH (FORMAT csv, HEADER true)"

  # Rows were inserted with explicit ids, so a table's identity sequence needs
  # to be advanced past the max id, or the next app-side INSERT will collide.
  # Not every table has its own generated `id` column (e.g. task_git_context's
  # PK is task_id, a foreign key into tasks — no sequence to fix), so check
  # first rather than assume.
  has_id_column=$(psql "$PG_URL" -t -A -c "
    SELECT 1 FROM information_schema.columns
    WHERE table_name = '$table' AND column_name = 'id'
  ")
  if [[ "$has_id_column" == "1" ]]; then
    psql "$PG_URL" -v ON_ERROR_STOP=1 -t -c "
      SELECT setval(
        pg_get_serial_sequence('$table', 'id'),
        GREATEST(COALESCE((SELECT MAX(id) FROM $table), 1), 1)
      )
      WHERE pg_get_serial_sequence('$table', 'id') IS NOT NULL;
    " >/dev/null
  fi
done

echo
echo "Done. Spot-check row counts, e.g.:"
echo "  psql \"$PG_URL\" -c 'SELECT count(*) FROM tasks;'"
