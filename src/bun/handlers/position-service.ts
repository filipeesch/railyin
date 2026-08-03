import type { Db } from "../db/db.ts";

export class PositionService {
  constructor(private readonly db: Db) {}

  async rebalanceColumnPositions(boardId: number, columnId: string): Promise<void> {
    const rows = await this.db
      .rows<{ id: number; position: number }>(
        "SELECT id, position FROM tasks WHERE board_id = $1 AND workflow_state = $2 ORDER BY position ASC",
        [boardId, columnId],
      );
    if (rows.length < 2) return;
    let needsRebalance = false;
    for (let i = 1; i < rows.length; i++) {
      if (rows[i].position - rows[i - 1].position < 1) {
        needsRebalance = true;
        break;
      }
    }
    if (!needsRebalance) return;
    await this.db.begin(async (tx) => {
      for (let i = 0; i < rows.length; i++) {
        await tx.exec("UPDATE tasks SET position = $1 WHERE id = $2", [(i + 1) * 1000, rows[i].id]);
      }
    });
  }

  async getTopPosition(boardId: number, columnId: string): Promise<number> {
    const row = await this.db
      .get<{ min_pos: number | null }>(
        "SELECT MIN(position) as min_pos FROM tasks WHERE board_id = $1 AND workflow_state = $2",
        [boardId, columnId],
      );
    return row?.min_pos != null ? row.min_pos / 2 : 500;
  }

  async reorderColumn(boardId: number, taskIds: number[]): Promise<void> {
    await this.db.begin(async (tx) => {
      for (let i = 0; i < taskIds.length; i++) {
        await tx.exec(
          "UPDATE tasks SET position = $1 WHERE id = $2 AND board_id = $3",
          [(i + 1) * 1000, taskIds[i], boardId],
        );
      }
    });
  }
}
