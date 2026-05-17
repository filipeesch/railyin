/**
 * Workflow file management — a focused, database-agnostic module that owns
 * everything about workflow YAML files: where the bundled source lives, seeding
 * a workspace from it, discovering files, and creating/deleting them.
 *
 * It performs no database access. Delete-guard evaluation is a pure function;
 * callers supply the board reference counts.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, copyFileSync, unlinkSync } from "fs";
import { join, resolve } from "path";
import yaml from "js-yaml";
import type { WorkflowTemplateConfig } from "./index.ts";

// Injected at build time via --define for dev builds (see scripts/dev.ts).
// Undefined in production and tests.
declare const __RAILYN_DEV_CONFIG_DIR__: string | undefined;

function isWorkflowFile(fileName: string): boolean {
  return fileName.endsWith(".yaml") || fileName.endsWith(".yml");
}

/**
 * Resolve the directory holding the bundled workflow templates that fresh
 * workspaces are seeded from. Resolution order:
 *  1. `RAILYN_BUNDLED_WORKFLOWS_DIR` env var (tests / explicit override),
 *  2. `<__RAILYN_DEV_CONFIG_DIR__>/workflows` when the dev `--define` constant
 *     is present and that directory exists,
 *  3. the `config/workflows` directory shipped alongside the source tree.
 */
export function getBundledWorkflowsDir(): string {
  if (process.env.RAILYN_BUNDLED_WORKFLOWS_DIR) return process.env.RAILYN_BUNDLED_WORKFLOWS_DIR;
  if (typeof __RAILYN_DEV_CONFIG_DIR__ !== "undefined" && __RAILYN_DEV_CONFIG_DIR__) {
    const devDir = join(__RAILYN_DEV_CONFIG_DIR__, "workflows");
    if (existsSync(devDir)) return devDir;
  }
  // This module lives at src/bun/config/ — the repo's config/workflows is three
  // levels up. Production runs from the source tree, so it ships with the install.
  return resolve(import.meta.dir, "../../../config/workflows");
}

/**
 * The minimal but valid workflow template — Backlog → In Progress → Done.
 * Used both for newly created workflows and as the last-resort seeding fallback.
 */
export function getMinimalWorkflow(id = "delivery", name = "Delivery Flow"): WorkflowTemplateConfig {
  return {
    id,
    name,
    columns: [
      { id: "backlog", label: "Backlog", description: "Tasks waiting to be started", is_backlog: true },
      { id: "in_progress", label: "In Progress", description: "Active development" },
      { id: "done", label: "Done", description: "Task complete" },
    ],
  };
}

/**
 * Seed `targetDir` from the bundled workflows source. Every bundled YAML file is
 * copied in, but only when a file of that exact name is not already present —
 * user customizations are never overwritten. When the bundled source is missing
 * or empty and the target still has no workflow file, a minimal delivery
 * workflow is written as a last resort.
 */
export function seedWorkflows(targetDir: string, sourceDir: string = getBundledWorkflowsDir()): void {
  mkdirSync(targetDir, { recursive: true });

  if (existsSync(sourceDir)) {
    for (const fileName of readdirSync(sourceDir)) {
      if (!isWorkflowFile(fileName)) continue;
      const dest = join(targetDir, fileName);
      if (existsSync(dest)) continue;
      copyFileSync(join(sourceDir, fileName), dest);
    }
  }

  const targetHasWorkflow = readdirSync(targetDir).some(isWorkflowFile);
  if (!targetHasWorkflow) {
    writeFileSync(join(targetDir, "delivery.yaml"), yaml.dump(getMinimalWorkflow()), "utf-8");
  }
}

/**
 * Resolve the on-disk path of a workflow template within a config directory.
 * Tries `<id>.yaml` directly, then scans every workflow file and matches the
 * parsed `id` field. Returns `null` when no file backs the template.
 */
export function resolveWorkflowFilePath(configDir: string, templateId: string): string | null {
  const workflowsDir = join(configDir, "workflows");
  const directPath = join(workflowsDir, `${templateId}.yaml`);
  if (existsSync(directPath)) return directPath;

  if (!existsSync(workflowsDir)) return null;
  for (const fileName of readdirSync(workflowsDir)) {
    if (!isWorkflowFile(fileName)) continue;
    const filePath = join(workflowsDir, fileName);
    try {
      const parsed = yaml.load(readFileSync(filePath, "utf-8")) as { id?: string } | null;
      if (parsed?.id === templateId) return filePath;
    } catch {
      // Ignore invalid files when searching; validation happens elsewhere.
    }
  }
  return null;
}

/** Discover all valid workflow templates in a config directory. */
export function listWorkflowFiles(configDir: string): { id: string; name: string }[] {
  const workflowsDir = join(configDir, "workflows");
  if (!existsSync(workflowsDir)) return [];

  const result: { id: string; name: string }[] = [];
  for (const fileName of readdirSync(workflowsDir)) {
    if (!isWorkflowFile(fileName)) continue;
    try {
      const parsed = yaml.load(readFileSync(join(workflowsDir, fileName), "utf-8")) as WorkflowTemplateConfig | null;
      if (parsed?.id && parsed?.columns) {
        result.push({ id: parsed.id, name: parsed.name ?? parsed.id });
      }
    } catch {
      // Skip unparseable files.
    }
  }
  return result;
}

/**
 * Slugify a workflow name into an id: lowercase, non-alphanumeric runs become
 * dashes, leading/trailing dashes trimmed. Falls back to `workflow` when the
 * name contains nothing slug-able.
 */
function slugifyWorkflowName(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "workflow";
}

/**
 * Create a new workflow file from a name. The id is the slug of the name, with
 * a numeric suffix appended on filename collision so creation never fails.
 * Returns the new workflow id.
 */
export function createWorkflowFile(configDir: string, name: string): string {
  const workflowsDir = join(configDir, "workflows");
  mkdirSync(workflowsDir, { recursive: true });

  const base = slugifyWorkflowName(name);
  let id = base;
  for (let n = 2; existsSync(join(workflowsDir, `${id}.yaml`)); n++) {
    id = `${base}-${n}`;
  }

  const template = getMinimalWorkflow(id, name.trim() || id);
  writeFileSync(join(workflowsDir, `${id}.yaml`), yaml.dump(template), "utf-8");
  return id;
}

/** Delete a workflow file. Throws when no file backs the template. */
export function deleteWorkflowFile(configDir: string, templateId: string): void {
  const filePath = resolveWorkflowFilePath(configDir, templateId);
  if (!filePath) throw new Error(`Workflow template not found: ${templateId}`);
  unlinkSync(filePath);
}

/**
 * Pure delete-guard evaluation. A workflow cannot be deleted while it is
 * referenced by a board, or while it is the only workflow left. The
 * referenced-by-board reason takes precedence when both apply.
 */
export function evaluateDeletable(
  templateId: string,
  boardCountById: Record<string, number>,
  totalWorkflows: number,
): { deletable: boolean; undeletableReason: string | null } {
  const count = boardCountById[templateId] ?? 0;
  if (count > 0) {
    return { deletable: false, undeletableReason: `In use by ${count} board${count === 1 ? "" : "s"}` };
  }
  if (totalWorkflows <= 1) {
    return { deletable: false, undeletableReason: "The last workflow cannot be deleted" };
  }
  return { deletable: true, undeletableReason: null };
}
