/**
 * Tests for the autonomous refinement loop utilities in refinement/runner.ts
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  backupFiles,
  restoreFiles,
  writeFindingsReport,
  writeCaptureSummary,
  evaluateMetricContract,
  hasPlateaued,
} from "../runner.ts";
import type { Finding, FindingsReport, RunReport, RoundSummary } from "../types.ts";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeTempDir(): string {
  const dir = join(tmpdir(), `refine-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: "F001",
    category: "token_waste",
    source: { file: "", line: 1, symbol: "buildTools" },
    evidence: {
      doc_reference: "https://docs.anthropic.com/en/docs/tool-use",
      doc_quote: "Keep descriptions concise.",
    },
    metric_contract: {
      metric: "total_cost",
      before: 0.0100,
      expected_after: 0.0080,
    },
    change: { type: "edit", description: "Trim tool descriptions" },
    status: "pending",
    ...overrides,
  };
}

function makeRunReport(total_cost: number, cache_hit_ratio = 0.5): RunReport {
  return {
    mode: "mock",
    timestamp: new Date().toISOString(),
    pass: true,
    scenarios: [
      {
        name: "test-scenario",
        pass: true,
        assertions: [{ type: "cache_prefix_stable", pass: true, message: "ok" }],
        metrics: {
          tools_count: [10],
          tools_hash_values: ["abc123"],
          cache_hit_ratio,
          max_tokens_values: [4096],
        },
        total_cost,
        all_cold_cost: total_cost * 2,
        cache_savings: total_cost,
        cache_savings_pct: 50,
      },
    ],
    metrics: { cache_hit_ratio },
    total_cost,
    all_cold_cost: total_cost * 2,
    cache_savings: total_cost,
    cache_savings_pct: 50,
  };
}

// ─── 9.1 Finding status lifecycle ─────────────────────────────────────────────

describe("Finding status lifecycle", () => {
  it("starts as pending", () => {
    const f = makeFinding();
    expect(f.status).toBe("pending");
  });

  it("transitions to applied before evaluation", () => {
    const f = makeFinding();
    f.status = "applied";
    expect(f.status).toBe("applied");
  });

  it("transitions to confirmed when metric improves", () => {
    const f = makeFinding({ status: "applied" });
    const report = makeRunReport(0.007); // better than expected_after 0.008
    const outcome = evaluateMetricContract(f, report);
    expect(outcome).toBe("confirmed");
    f.status = outcome;
    expect(f.status).toBe("confirmed");
  });

  it("transitions to rolled_back when metric worsens", () => {
    const f = makeFinding({ status: "applied" });
    const report = makeRunReport(0.011); // worse than before 0.010
    const outcome = evaluateMetricContract(f, report);
    expect(outcome).toBe("rolled_back");
    f.status = outcome;
    expect(f.status).toBe("rolled_back");
  });

  it("transitions to ineffective when metric is neutral", () => {
    const f = makeFinding({ status: "applied" });
    const report = makeRunReport(0.0095); // better than before but NOT ≤ expected_after
    // expected_after is 0.008, and 0.0095 > 0.008, so it's not confirmed
    // before is 0.010, and 0.0095 < 0.010, so it's not worsened
    const outcome = evaluateMetricContract(f, report);
    expect(outcome).toBe("ineffective");
    f.status = outcome;
    expect(f.status).toBe("ineffective");
  });
});

// ─── 9.2 backupFiles / restoreFiles ───────────────────────────────────────────

describe("backupFiles / restoreFiles", () => {
  let tmpDir: string;
  let reportDir: string;
  let testFile: string;

  beforeEach(() => {
    tmpDir = makeTempDir();
    reportDir = join(tmpDir, "report");
    mkdirSync(reportDir, { recursive: true });
    testFile = join(tmpDir, "target.ts");
    writeFileSync(testFile, "original content");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("backs up a file to the backup directory", () => {
    backupFiles(reportDir, "F001", [testFile]);
    const backupPath = join(reportDir, "backups", "F001", "target.ts");
    expect(existsSync(backupPath)).toBe(true);
    expect(readFileSync(backupPath, "utf-8")).toBe("original content");
  });

  it("restores file to original content after mutation", () => {
    backupFiles(reportDir, "F001", [testFile]);

    // Mutate the file
    writeFileSync(testFile, "mutated content");
    expect(readFileSync(testFile, "utf-8")).toBe("mutated content");

    // Restore
    restoreFiles(reportDir, "F001");
    expect(readFileSync(testFile, "utf-8")).toBe("original content");
  });

  it("writes a manifest.json listing original paths", () => {
    backupFiles(reportDir, "F001", [testFile]);
    const manifest = JSON.parse(
      readFileSync(join(reportDir, "backups", "F001", "manifest.json"), "utf-8"),
    );
    expect(manifest["target.ts"]).toBe(testFile);
  });

  it("is a no-op for non-existent files", () => {
    // Should not throw
    expect(() => backupFiles(reportDir, "F002", ["/nonexistent/file.ts"])).not.toThrow();
  });
});

// ─── 9.3 writeCaptureSummary ──────────────────────────────────────────────────

describe("writeCaptureSummary", () => {
  let reportDir: string;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTempDir();
    reportDir = join(tmpDir, "report");
    mkdirSync(reportDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("writes capture-summary.json with the correct shape", () => {
    const report = makeRunReport(0.01);
    writeCaptureSummary(reportDir, report);

    const summaryPath = join(reportDir, "capture-summary.json");
    expect(existsSync(summaryPath)).toBe(true);

    const summary = JSON.parse(readFileSync(summaryPath, "utf-8"));
    expect(summary.total_cost).toBe(0.01);
    expect(summary.cache_hit_ratio).toBe(0.5);
    expect(Array.isArray(summary.scenarios)).toBe(true);
    expect(summary.scenarios[0].name).toBe("test-scenario");
    expect(summary.report_dir).toBe(reportDir);
  });

  it("includes scenario capture paths (empty when no captures exist)", () => {
    const report = makeRunReport(0.01);
    const summary = writeCaptureSummary(reportDir, report);
    expect(Array.isArray(summary.scenarios[0].capture_paths)).toBe(true);
  });
});

// ─── 9.4 writeFindingsReport (incremental) ────────────────────────────────────

describe("writeFindingsReport", () => {
  let reportDir: string;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTempDir();
    reportDir = join(tmpDir, "report");
    mkdirSync(reportDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("writes findings-report.json", () => {
    const report: FindingsReport = {
      run_id: "ts-001",
      timestamp: new Date().toISOString(),
      mode: "auto",
      rounds: [],
      findings: [makeFinding({ status: "confirmed" })],
      summary: {
        confirmed: 1,
        rolled_back: 0,
        ineffective: 0,
        total_cost_before: 0.01,
        total_cost_after: 0.008,
        improvement_pct: 20,
      },
    };

    writeFindingsReport(reportDir, report);

    const path = join(reportDir, "findings-report.json");
    expect(existsSync(path)).toBe(true);
    const read = JSON.parse(readFileSync(path, "utf-8"));
    expect(read.summary.confirmed).toBe(1);
    expect(read.findings[0].status).toBe("confirmed");
  });

  it("overwrites with updated finding status on second write", () => {
    const findings: Finding[] = [makeFinding({ status: "pending" })];
    const report: FindingsReport = {
      run_id: "ts-002",
      timestamp: new Date().toISOString(),
      mode: "auto",
      rounds: [],
      findings,
      summary: {
        confirmed: 0, rolled_back: 0, ineffective: 0,
        total_cost_before: 0.01, total_cost_after: 0.01, improvement_pct: 0,
      },
    };

    writeFindingsReport(reportDir, report);

    // Update finding status and write again
    findings[0].status = "confirmed";
    report.summary.confirmed = 1;
    writeFindingsReport(reportDir, report);

    const read = JSON.parse(readFileSync(join(reportDir, "findings-report.json"), "utf-8"));
    expect(read.findings[0].status).toBe("confirmed");
    expect(read.summary.confirmed).toBe(1);
  });
});

// ─── 9.5 Plateau detection ────────────────────────────────────────────────────

describe("hasPlateaued", () => {
  it("returns false when fewer than 4 rounds exist", () => {
    const rounds: RoundSummary[] = [
      { round: 1, findings_attempted: 1, findings_confirmed: 1, total_cost: 0.010 },
      { round: 2, findings_attempted: 1, findings_confirmed: 1, total_cost: 0.009 },
      { round: 3, findings_attempted: 1, findings_confirmed: 0, total_cost: 0.009 },
    ];
    expect(hasPlateaued(rounds)).toBe(false);
  });

  it("returns true when last 3 rounds each show < 1% improvement", () => {
    const rounds: RoundSummary[] = [
      { round: 1, findings_attempted: 1, findings_confirmed: 1, total_cost: 0.010 },
      { round: 2, findings_attempted: 1, findings_confirmed: 0, total_cost: 0.00995 }, // 0.05% improvement
      { round: 3, findings_attempted: 1, findings_confirmed: 0, total_cost: 0.00993 }, // 0.02% improvement
      { round: 4, findings_attempted: 1, findings_confirmed: 0, total_cost: 0.00992 }, // 0.01% improvement
    ];
    expect(hasPlateaued(rounds)).toBe(true);
  });

  it("returns false when at least one recent round shows >= 1% improvement", () => {
    const rounds: RoundSummary[] = [
      { round: 1, findings_attempted: 1, findings_confirmed: 1, total_cost: 0.010 },
      { round: 2, findings_attempted: 1, findings_confirmed: 1, total_cost: 0.009 }, // 10% improvement
      { round: 3, findings_attempted: 1, findings_confirmed: 0, total_cost: 0.00899 }, // 0.11% improvement
      { round: 4, findings_attempted: 1, findings_confirmed: 0, total_cost: 0.00898 }, // 0.11% improvement
    ];
    expect(hasPlateaued(rounds)).toBe(false);
  });
});

// ─── 9.6 Metric contract evaluation ──────────────────────────────────────────

describe("evaluateMetricContract", () => {
  it("confirms when total_cost is at or below expected_after", () => {
    const finding = makeFinding({
      metric_contract: { metric: "total_cost", before: 0.010, expected_after: 0.008 },
    });
    expect(evaluateMetricContract(finding, makeRunReport(0.007))).toBe("confirmed");
    expect(evaluateMetricContract(finding, makeRunReport(0.008))).toBe("confirmed");
  });

  it("rolls back when total_cost is worse than before", () => {
    const finding = makeFinding({
      metric_contract: { metric: "total_cost", before: 0.010, expected_after: 0.008 },
    });
    expect(evaluateMetricContract(finding, makeRunReport(0.011))).toBe("rolled_back");
  });

  it("marks ineffective when cost improved but not enough", () => {
    const finding = makeFinding({
      metric_contract: { metric: "total_cost", before: 0.010, expected_after: 0.008 },
    });
    // 0.009 is better than before (0.010) but NOT ≤ expected_after (0.008)
    expect(evaluateMetricContract(finding, makeRunReport(0.009))).toBe("ineffective");
  });

  it("confirms when cache_hit_ratio is at or above expected_after", () => {
    const finding = makeFinding({
      metric_contract: { metric: "cache_hit_ratio", before: 0.5, expected_after: 0.8 },
    });
    expect(evaluateMetricContract(finding, makeRunReport(0.01, 0.9))).toBe("confirmed");
    expect(evaluateMetricContract(finding, makeRunReport(0.01, 0.8))).toBe("confirmed");
  });

  it("rolls back when cache_hit_ratio is worse than before", () => {
    const finding = makeFinding({
      metric_contract: { metric: "cache_hit_ratio", before: 0.5, expected_after: 0.8 },
    });
    expect(evaluateMetricContract(finding, makeRunReport(0.01, 0.3))).toBe("rolled_back");
  });
});

// ─── 9.7 Assertion regression rollback ───────────────────────────────────────

describe("assertion regression detection (inline simulation)", () => {
  it("detects a pass→fail regression when comparing baseline to eval assertions", () => {
    const baseline: RunReport = makeRunReport(0.01);
    baseline.scenarios[0].assertions = [
      { type: "cache_prefix_stable", pass: true, message: "stable" },
      { type: "tools_hash_stable", pass: true, message: "stable" },
    ];

    const evalReport: RunReport = makeRunReport(0.008); // cost improved
    evalReport.scenarios[0].assertions = [
      { type: "cache_prefix_stable", pass: false, message: "hash changed" }, // regression!
      { type: "tools_hash_stable", pass: true, message: "stable" },
    ];

    let assertionRegression = false;
    for (const baseSc of baseline.scenarios) {
      const evalSc = evalReport.scenarios.find((s) => s.name === baseSc.name);
      if (!evalSc) continue;
      for (const baseA of baseSc.assertions) {
        if (!baseA.pass) continue;
        const evalA = evalSc.assertions.find((a) => a.type === baseA.type);
        if (evalA && !evalA.pass) {
          assertionRegression = true;
        }
      }
    }

    expect(assertionRegression).toBe(true);
  });

  it("does not trigger regression when a previously-failing assertion now passes", () => {
    const baseline: RunReport = makeRunReport(0.01);
    baseline.scenarios[0].assertions = [
      { type: "cache_prefix_stable", pass: false, message: "not stable" }, // was already failing
    ];

    const evalReport: RunReport = makeRunReport(0.008);
    evalReport.scenarios[0].assertions = [
      { type: "cache_prefix_stable", pass: true, message: "now stable" }, // improved
    ];

    let assertionRegression = false;
    for (const baseSc of baseline.scenarios) {
      const evalSc = evalReport.scenarios.find((s) => s.name === baseSc.name);
      if (!evalSc) continue;
      for (const baseA of baseSc.assertions) {
        if (!baseA.pass) continue; // only check previously-passing assertions
        const evalA = evalSc.assertions.find((a) => a.type === baseA.type);
        if (evalA && !evalA.pass) {
          assertionRegression = true;
        }
      }
    }

    expect(assertionRegression).toBe(false);
  });
});
