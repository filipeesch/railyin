import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import yaml from "js-yaml";
import {
  getBundledWorkflowsDir,
  getMinimalWorkflow,
  seedWorkflows,
  resolveWorkflowFilePath,
  listWorkflowFiles,
  createWorkflowFile,
  deleteWorkflowFile,
  evaluateDeletable,
} from "../config/workflows.ts";

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "railyn-wf-"));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

/** Write a minimal valid workflow YAML file. */
function writeWorkflow(dir: string, fileName: string, id: string, name = id): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, fileName),
    yaml.dump({ id, name, columns: [{ id: "backlog", label: "Backlog", is_backlog: true }] }),
    "utf-8",
  );
}

const isYaml = (f: string) => f.endsWith(".yaml") || f.endsWith(".yml");

// ─── getBundledWorkflowsDir ───────────────────────────────────────────────────

describe("getBundledWorkflowsDir", () => {
  it("honors the RAILYN_BUNDLED_WORKFLOWS_DIR env var", () => {
    const prev = process.env.RAILYN_BUNDLED_WORKFLOWS_DIR;
    process.env.RAILYN_BUNDLED_WORKFLOWS_DIR = tmp;
    try {
      expect(getBundledWorkflowsDir()).toBe(tmp);
    } finally {
      if (prev === undefined) delete process.env.RAILYN_BUNDLED_WORKFLOWS_DIR;
      else process.env.RAILYN_BUNDLED_WORKFLOWS_DIR = prev;
    }
  });

  it("falls back to an existing directory containing a workflow file", () => {
    const prev = process.env.RAILYN_BUNDLED_WORKFLOWS_DIR;
    delete process.env.RAILYN_BUNDLED_WORKFLOWS_DIR;
    try {
      const dir = getBundledWorkflowsDir();
      expect(existsSync(dir)).toBe(true);
      expect(readdirSync(dir).some(isYaml)).toBe(true);
    } finally {
      if (prev !== undefined) process.env.RAILYN_BUNDLED_WORKFLOWS_DIR = prev;
    }
  });
});

// ─── getMinimalWorkflow ───────────────────────────────────────────────────────

describe("getMinimalWorkflow", () => {
  it("returns a valid 3-column delivery template by default", () => {
    const wf = getMinimalWorkflow();
    expect(wf.id).toBe("delivery");
    expect(wf.columns.map((c) => c.id)).toEqual(["backlog", "in_progress", "done"]);
    expect(wf.columns[0]!.is_backlog).toBe(true);
  });

  it("accepts an explicit id and name", () => {
    const wf = getMinimalWorkflow("my-flow", "My Flow");
    expect(wf.id).toBe("my-flow");
    expect(wf.name).toBe("My Flow");
  });
});

// ─── seedWorkflows ────────────────────────────────────────────────────────────

describe("seedWorkflows", () => {
  it("copies all bundled files into an empty target", () => {
    const source = join(tmp, "source");
    const target = join(tmp, "target");
    writeWorkflow(source, "a.yaml", "a");
    writeWorkflow(source, "b.yml", "b");

    seedWorkflows(target, source);

    expect(existsSync(join(target, "a.yaml"))).toBe(true);
    expect(existsSync(join(target, "b.yml"))).toBe(true);
  });

  it("never overwrites an existing file with the same name", () => {
    const source = join(tmp, "source");
    const target = join(tmp, "target");
    writeWorkflow(source, "delivery.yaml", "delivery", "Bundled");
    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, "delivery.yaml"), "id: delivery\nname: User Edited\ncolumns: []\n", "utf-8");

    seedWorkflows(target, source);

    expect(readFileSync(join(target, "delivery.yaml"), "utf-8")).toContain("User Edited");
  });

  it("copies only the files that are absent in the target", () => {
    const source = join(tmp, "source");
    const target = join(tmp, "target");
    writeWorkflow(source, "a.yaml", "a");
    writeWorkflow(source, "b.yaml", "b");
    writeWorkflow(target, "a.yaml", "a", "kept");

    seedWorkflows(target, source);

    expect(readFileSync(join(target, "a.yaml"), "utf-8")).toContain("kept");
    expect(existsSync(join(target, "b.yaml"))).toBe(true);
  });

  it("ignores non-YAML files in the source", () => {
    const source = join(tmp, "source");
    const target = join(tmp, "target");
    writeWorkflow(source, "a.yaml", "a");
    writeFileSync(join(source, "notes.txt"), "not a workflow", "utf-8");

    seedWorkflows(target, source);

    expect(existsSync(join(target, "notes.txt"))).toBe(false);
    expect(existsSync(join(target, "a.yaml"))).toBe(true);
  });

  it("writes the minimal delivery fallback when the source is missing and the target is empty", () => {
    const target = join(tmp, "target");

    seedWorkflows(target, join(tmp, "does-not-exist"));

    const deliveryPath = join(target, "delivery.yaml");
    expect(existsSync(deliveryPath)).toBe(true);
    const parsed = yaml.load(readFileSync(deliveryPath, "utf-8")) as { id: string; columns: unknown[] };
    expect(parsed.id).toBe("delivery");
    expect(parsed.columns).toHaveLength(3);
  });

  it("writes the minimal delivery fallback when the source is empty and the target is empty", () => {
    const source = join(tmp, "source");
    const target = join(tmp, "target");
    mkdirSync(source, { recursive: true });

    seedWorkflows(target, source);

    expect(existsSync(join(target, "delivery.yaml"))).toBe(true);
  });

  it("does not write the fallback when the target already has a workflow", () => {
    const target = join(tmp, "target");
    writeWorkflow(target, "custom.yaml", "custom");

    seedWorkflows(target, join(tmp, "does-not-exist"));

    expect(existsSync(join(target, "delivery.yaml"))).toBe(false);
    expect(readdirSync(target).filter(isYaml)).toEqual(["custom.yaml"]);
  });
});

// ─── resolveWorkflowFilePath ──────────────────────────────────────────────────

describe("resolveWorkflowFilePath", () => {
  it("resolves a template by direct filename", () => {
    writeWorkflow(join(tmp, "workflows"), "delivery.yaml", "delivery");
    expect(resolveWorkflowFilePath(tmp, "delivery")).toBe(join(tmp, "workflows", "delivery.yaml"));
  });

  it("resolves a template by parsed id when the filename differs", () => {
    writeWorkflow(join(tmp, "workflows"), "open-spec.yaml", "openspec");
    expect(resolveWorkflowFilePath(tmp, "openspec")).toBe(join(tmp, "workflows", "open-spec.yaml"));
  });

  it("returns null when no file backs the template", () => {
    mkdirSync(join(tmp, "workflows"), { recursive: true });
    expect(resolveWorkflowFilePath(tmp, "ghost")).toBeNull();
  });
});

// ─── listWorkflowFiles ────────────────────────────────────────────────────────

describe("listWorkflowFiles", () => {
  it("returns id and name for every valid workflow file", () => {
    const dir = join(tmp, "workflows");
    writeWorkflow(dir, "a.yaml", "a", "Alpha");
    writeWorkflow(dir, "b.yaml", "b", "Beta");

    const result = listWorkflowFiles(tmp).sort((x, y) => x.id.localeCompare(y.id));
    expect(result).toEqual([
      { id: "a", name: "Alpha" },
      { id: "b", name: "Beta" },
    ]);
  });

  it("skips unparseable YAML files", () => {
    const dir = join(tmp, "workflows");
    writeWorkflow(dir, "good.yaml", "good");
    writeFileSync(join(dir, "broken.yaml"), "id: broken\n  : : bad", "utf-8");

    expect(listWorkflowFiles(tmp).map((w) => w.id)).toEqual(["good"]);
  });

  it("returns an empty array when the workflows directory is missing", () => {
    expect(listWorkflowFiles(tmp)).toEqual([]);
  });
});

// ─── createWorkflowFile ───────────────────────────────────────────────────────

describe("createWorkflowFile", () => {
  it("slugifies the name into the id and filename", () => {
    const id = createWorkflowFile(tmp, "My New Flow");
    expect(id).toBe("my-new-flow");
    expect(existsSync(join(tmp, "workflows", "my-new-flow.yaml"))).toBe(true);
  });

  it("appends a numeric suffix on collision", () => {
    expect(createWorkflowFile(tmp, "Flow")).toBe("flow");
    expect(createWorkflowFile(tmp, "Flow")).toBe("flow-2");
    expect(createWorkflowFile(tmp, "Flow")).toBe("flow-3");
  });

  it("falls back to the id 'workflow' when the name has no slug-able characters", () => {
    expect(createWorkflowFile(tmp, "!!!")).toBe("workflow");
  });

  it("writes a valid minimal template with a backlog column", () => {
    const id = createWorkflowFile(tmp, "Sprint Board");
    const parsed = yaml.load(readFileSync(join(tmp, "workflows", `${id}.yaml`), "utf-8")) as {
      id: string;
      name: string;
      columns: { id: string; is_backlog?: boolean }[];
    };
    expect(parsed.name).toBe("Sprint Board");
    expect(parsed.columns).toHaveLength(3);
    expect(parsed.columns[0]!.is_backlog).toBe(true);
  });
});

// ─── deleteWorkflowFile ───────────────────────────────────────────────────────

describe("deleteWorkflowFile", () => {
  it("removes the workflow file", () => {
    writeWorkflow(join(tmp, "workflows"), "gone.yaml", "gone");
    deleteWorkflowFile(tmp, "gone");
    expect(existsSync(join(tmp, "workflows", "gone.yaml"))).toBe(false);
  });

  it("throws when the template has no backing file", () => {
    mkdirSync(join(tmp, "workflows"), { recursive: true });
    expect(() => deleteWorkflowFile(tmp, "ghost")).toThrow();
  });
});

// ─── evaluateDeletable ────────────────────────────────────────────────────────

describe("evaluateDeletable", () => {
  it("reports a free workflow as deletable", () => {
    expect(evaluateDeletable("a", { a: 0 }, 3)).toEqual({ deletable: true, undeletableReason: null });
  });

  it("reports a referenced workflow as not deletable", () => {
    const result = evaluateDeletable("a", { a: 2 }, 3);
    expect(result.deletable).toBe(false);
    expect(result.undeletableReason).toMatch(/board/i);
  });

  it("reports the last remaining workflow as not deletable", () => {
    const result = evaluateDeletable("a", { a: 0 }, 1);
    expect(result.deletable).toBe(false);
    expect(result.undeletableReason).toMatch(/last/i);
  });

  it("prefers the referenced reason when a workflow is both referenced and last", () => {
    const result = evaluateDeletable("a", { a: 1 }, 1);
    expect(result.deletable).toBe(false);
    expect(result.undeletableReason).toMatch(/board/i);
  });
});
