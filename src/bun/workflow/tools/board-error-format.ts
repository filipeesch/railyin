/**
 * buildBoardNotFoundError — Pure function to format board-not-found error messages.
 *
 * Returns a user-friendly error message that includes available boards
 * (scoped to the current workspace) so the model can extract board_id
 * directly from the error without calling list_boards.
 */

export function buildBoardNotFoundError(
  boards: Array<{ id: number; name: string }>,
): string {
  if (boards.length === 0) {
    return "Error: board_id is required. No boards are currently available.";
  }
  const list = boards
    .map((b) => `Board #${b.id}: "${b.name}"`)
    .join(", ");
  return `Error: board_id is required. Available boards: ${list}`;
}
