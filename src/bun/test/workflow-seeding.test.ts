import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import yaml from "js-yaml";
import { loadConfig, resetConfig } from "../config/index.ts";
import { resolveWorkflowFilePath } from "../config/workflows.ts";

let cleanups: (() => void)[] = [];

afterEach(() => {
  for (const c of cleanups) c();
  cleanups = [];
  resetConfig();
});

const isYaml = (f: string) => f.endsWith(".yaml") || f.endsWith(".yml");

/** Build a temp config dir; returns its paths. `workflows` seeds the workflows dir up front. */
function makeConfigDir(opts: { workflows?: { file: string; id: string }[]; bundledSource?: string } = {}) {
  const configDir = mkdtempSync(join(tmpdir(), "railyn-seedcfg-"));
  const workspacePath = join(configDir, "workspace");
  mkdirSync(workspacePath, { recursive: true });
  writeFileSync(join(configDir, "workspace.test.yaml"), `name: test\nworkspace_path: ${workspacePath}\nprojects: []\n`);
  writeFileSync(join(configDir, "engines.yaml"), "engines:\n  - id: copilot\n    type: copilot\n");

  const workflowsDir = join(configDir, "workflows");
  if (opts.workflows) {
    mkdirSync(workflowsDir, { recursive: true });
    for (const w of opts.workflows) {
      writeFileSync(
        join(workflowsDir, w.file),
        yaml.dump({ id: w.id, name: w.id, columns: [{ id: "backlog", label: "Backlog", is_backlog: true }] }),
      );
    }
  }

  process.env.RAILYN_DB = ":memory:";
  process.env.RAILYN_CONFIG_DIR = configDir;
  // Default the bundled source to this config's own workflows dir so seeding is
  // a deterministic no-op unless a test explicitly supplies a source.
  process.env.RAILYN_BUNDLED_WORKFLOWS_DIR = opts.bundledSource ?? workflowsDir;
  resetConfig();

  cleanups.push(() => {
    rmSync(configDir, { recursive: true, force: true });
    delete process.env.RAILYN_CONFIG_DIR;
    delete process.env.RAILYN_DB;
    delete process.env.RAILYN_BUNDLED_WORKFLOWS_DIR;
    resetConfig();
  });
  return { configDir, workflowsDir };
}

describe("config loader — no phantom delivery fallback", () => {
  it("does not append an in-memory delivery template when no delivery file exists", () => {
    const { configDir } = makeConfigDir({ workflows: [{ file: "sprint.yaml", id: "sprint" }] });

    const { config, error } = loadConfig();
    expect(error).toBeNull();
    expect(config).not.toBeNull();

    const ids = config!.workflows.map((w) => w.id);
    expect(ids).toEqual(["sprint"]);
    expect(ids).not.toContain("delivery");
  });

  it("backs every loaded workflow with a resolvable file", () => {
    const { configDir } = makeConfigDir({
      workflows: [
        { file: "sprint.yaml", id: "sprint" },
        { file: "open-spec.yaml", id: "openspec" },
      ],
    });

    const { config } = loadConfig();
    for (const wf of config!.workflows) {
      expect(resolveWorkflowFilePath(configDir, wf.id)).not.toBeNull();
    }
  });
});

describe("config loader — fresh workspace seeding", () => {
  it("seeds the workspace from the bundled source on first load", () => {
    const source = mkdtempSync(join(tmpdir(), "railyn-bundled-"));
    cleanups.push(() => rmSync(source, { recursive: true, force: true }));
    writeFileSync(
      join(source, "sprint.yaml"),
      yaml.dump({ id: "sprint", name: "Sprint", columns: [{ id: "backlog", label: "Backlog", is_backlog: true }] }),
    );

    // No workflows dir up front — loadConfig must create and seed it.
    const { workflowsDir } = makeConfigDir({ bundledSource: source });

    const { config } = loadConfig();
    expect(config!.workflows.map((w) => w.id)).toContain("sprint");
    expect(readdirSync(workflowsDir).filter(isYaml).length).toBeGreaterThanOrEqual(1);
  });

  it("falls back to a minimal delivery workflow when the bundled source is empty", () => {
    const emptySource = mkdtempSync(join(tmpdir(), "railyn-bundled-empty-"));
    cleanups.push(() => rmSync(emptySource, { recursive: true, force: true }));

    const { config } = (() => {
      makeConfigDir({ bundledSource: emptySource });
      return loadConfig();
    })();

    expect(config!.workflows.length).toBeGreaterThanOrEqual(1);
    expect(config!.workflows.map((w) => w.id)).toContain("delivery");
  });
});
