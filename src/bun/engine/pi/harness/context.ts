export interface HarnessContext {
  undoStack: import("./undo-stack.ts").UndoStack;
  worktreePath: string;
  loopDetector: import("./tool-loop-detector.ts").ToolLoopDetector;
}
