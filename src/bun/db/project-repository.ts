import type { Project } from "../../shared/rpc-types.ts";
import { listProjectsForWorkspace } from "../project-store.ts";

// ─── Interface ────────────────────────────────────────────────────────────────

export interface IProjectRepository {
  listByWorkspace(workspaceKey: string): Project[];
}

// ─── Config-backed implementation ─────────────────────────────────────────────

export class ConfigProjectRepository implements IProjectRepository {
  listByWorkspace(workspaceKey: string): Project[] {
    return listProjectsForWorkspace(workspaceKey);
  }
}
