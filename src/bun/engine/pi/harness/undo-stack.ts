import { randomBytes } from "node:crypto";

type DistributiveOmit<T, K extends string> = T extends unknown ? Omit<T, K> : never;

export type WriteSnapshot =
  | {
      operationId: string;
      type: "write_file" | "patch_file" | "delete_file";
      path: string;
      beforeContent: string | null;
    }
  | {
      operationId: string;
      type: "rename_file";
      path: string;
      beforeContent: null;
      toPath: string;
    }
  | {
      operationId: string;
      type: "lsp_rename";
      beforeFiles: Record<string, string | null>;
    };

export class UndoStack {
  private stack: WriteSnapshot[] = [];
  private readonly maxSize: number;

  constructor(maxSize: number = 50) {
    this.maxSize = maxSize;
  }

  push(snapshot: DistributiveOmit<WriteSnapshot, "operationId">): string {
    const operationId = randomBytes(2).toString("hex");
    this.stack.push({ ...snapshot, operationId } as WriteSnapshot);
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
      const snap = this.stack[i];
      if ("path" in snap && snap.path === path) {
        return this.stack.splice(i, 1)[0];
      }
    }
    return undefined;
  }

  get size(): number {
    return this.stack.length;
  }
}
