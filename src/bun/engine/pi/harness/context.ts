export interface HarnessContext {
  undoStack: import("./undo-stack.ts").UndoStack;
  worktreePath: string;
  loopDetector: import("./tool-loop-detector.ts").ToolLoopDetector;
  /** Aborts when the current execution is cancelled. Refreshed on every turn. */
  signal: AbortSignal;
}
