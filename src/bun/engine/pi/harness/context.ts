export interface HarnessContext {
  undoStack: import("./undo-stack.ts").UndoStack;
  worktreePath: string;
}
