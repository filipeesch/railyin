import type { Database } from "bun:sqlite";

export class PositionService {
  constructor(private readonly db: Database) {}

  rebalanceColumnPositions(boardId: number, columnId: string): void {
    const rows = this.db
      .query<{ id: number; position: number }, [number, string]>(
        "SELECT id, position FROM tasks WHERE board_id = ? AND workflow_state = ? ORDER BY position ASC",
      )
      .all(boardId, columnId);
    if (rows.length < 2) return;
    let needsRebalance = false;
    for (let i = 1; i < rows.length; i++) {
      if (rows[i].position - rows[i - 1].position < 1) {
        needsRebalance = true;
        break;
      }
    }
    if (!needsRebalance) return;
    this.db.transaction(() => {
      for (let i = 0; i < rows.length; i++) {
        this.db.run("UPDATE tasks SET position = ? WHERE id = ?", [(i + 1) * 1000, rows[i].id]);
      }
    })();
  }

  reorderColumn(boardId: number, taskIds: number[]): void {
    this.db.transaction(() => {
      for (let i = 0; i < taskIds.length; i++) {
        this.db.run(
          "UPDATE tasks SET position = ? WHERE id = ? AND board_id = ?",
          [(i + 1) * 1000, taskIds[i], boardId],
        );
      }
    })();
  }
}
