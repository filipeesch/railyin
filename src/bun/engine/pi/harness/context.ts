export interface HarnessContext {
  hashCache: import("./hash-cache.ts").ContentHashCache;
  undoStack: import("./undo-stack.ts").UndoStack;
  worktreePath: string;
}
