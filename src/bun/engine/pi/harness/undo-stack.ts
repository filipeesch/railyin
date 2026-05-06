import { randomBytes } from "node:crypto";

export interface WriteSnapshot {
  operationId: string;
  path: string;
  type: "write_file" | "patch_file" | "delete_file" | "rename_file";
  beforeContent: string | null;
  toPath?: string;
}

export class UndoStack {
  private stack: WriteSnapshot[] = [];
  private readonly maxSize: number;

  constructor(maxSize: number = 50) {
    this.maxSize = maxSize;
  }

  push(snapshot: Omit<WriteSnapshot, "operationId">): string {
    const operationId = randomBytes(2).toString("hex");
    this.stack.push({ ...snapshot, operationId });
    if (this.stack.length > this.maxSize) {
      this.stack.shift();
    }
    return `op:${operationId}`;
  }

  undoById(operationId: string): WriteSnapshot | undefined {
    const idx = this.stack.findIndex((s) => s.operationId === operationId);
    if (idx === -1) return undefined;
    return this.stack.splice(idx, 1)[0];
  }

  popByPath(path: string): WriteSnapshot | undefined {
    for (let i = this.stack.length - 1; i >= 0; i--) {
      if (this.stack[i].path === path) {
        return this.stack.splice(i, 1)[0];
      }
    }
    return undefined;
  }

  get size(): number {
    return this.stack.length;
  }
}
