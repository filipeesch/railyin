/**
 * refinement/runner.ts
 *
 * CLI orchestrator: starts the proxy, loads scenarios, runs all modes through
 * the engine headlessly, evaluates assertions, writes per-request JSON captures,
 * generates JSON reports, and optionally compares against a baseline report.
 *
 * Usage:
 *   bun refinement/runner.ts --mode mock
 *   bun refinement/runner.ts --mode local --local-model lmstudio/qwen2.5-coder
 *   bun refinement/runner.ts --mode mock --scenario single-agent-multi-turn
 *   bun refinement/runner.ts --mode mock --compare refinement/reports/baseline/report.json
 *
 * Provider-based usage:
 *   bun refinement/runner.ts --providers mock-default
 *   bun refinement/runner.ts --providers lmstudio-qwen,anthropic-sonnet --scenarios export-markdown,new-tool
 *
 * Auto loop:
 *   bun refinement/runner.ts --mode auto
 *   bun refinement/runner.ts --mode auto --providers lmstudio-qwen
 *   bun refinement/runner.ts --mode auto --phase evaluate --finding-id F001 --findings reports/.../findings.json --report-dir reports/...
 */

import { writeFileSync, readFileSync, mkdirSync, readdirSync, existsSync } from "fs";
import { join, basename } from "path";
import { spawnSync } from "child_process";
import { createProxy } from "./proxy.ts";
import { loadAllScenarios, loadNamedScenario } from "./scenarios.ts";
import { evaluateAssertions, evaluateBehavioralAssertions } from "./assertions.ts";
import { runScenarioThroughEngine } from "./engine-runner.ts";
import { generateAnalysis } from "./analysis.ts";
import { loadProviders, selectProviders, getModelId } from "./providers.ts";
import { checkLmsCli, setupProvider } from "./lmstudio.ts";
import { createWorktree, resetWorktree, removeWorktree } from "./worktree.ts";
import type {
  CostEstimate,
  ProxyMode,
  ProviderConfig,
  ProviderPricing,
  ProvidersYaml,
  RunReport,
  ScenarioReport,
  Scenario,
  Finding,
  FindingsReport,
  CaptureSummary,
  RoundSummary,
  ScenarioCaptureSummary,
} from "./types.ts";

const REPORTS_DIR = join(import.meta.dir, "reports");

// ─── Cost helpers ─────────────────────────────────────────────────────────────

/** Recompute what a request would cost if the cache was cold (cache_write instead of cache_read). */
function coldCostFromRecord(c: CostEstimate, pricing?: ProviderPricing): number {
  const prefixTokens = c.tools_tokens + c.system_tokens;
  return (
    (prefixTokens / 1_000_000) * (pricing?.cache_write ?? 6.0) +
    (c.messages_tokens / 1_000_000) * (pricing?.input ?? 3.0) +
    (c.output_tokens / 1_000_000) * (pricing?.output ?? 15.0)
  );
}

function fmt(n: number): string {
  return `$${n.toFixed(4)}`;
}

// ─── Auto-loop helpers ────────────────────────────────────────────────────────

/**
 * Build a CaptureSummary from a completed RunReport and write it to
 * `<reportDir>/capture-summary.json`. Per-scenario capture file paths are
 * derived from the requests sub-directory that the run just populated.
 */
export function writeCaptureSummary(reportDir: string, report: RunReport): CaptureSummary {
  const scenarios: ScenarioCaptureSummary[] = report.scenarios.map((s) => {
    const requestsDir = join(reportDir, "requests", s.name);
    let capturePaths: string[] = [];
    if (existsSync(requestsDir)) {
      capturePaths = readdirSync(requestsDir)
        .filter((f) => f.endsWith(".json"))
        .sort()
        .map((f) => join(requestsDir, f));
    }

    // Derive per-request averages from capture files when available.
    let totalTools = 0;
    let totalSystem = 0;
    let totalMessages = 0;
    const count = capturePaths.length || 1;
    if (capturePaths.length > 0) {
      for (const p of capturePaths) {
        try {
          const data = JSON.parse(readFileSync(p, "utf-8"));
          const cost = data.cost ?? data.inspection?.cost ?? {};
          totalTools += cost.tools_tokens ?? 0;
          totalSystem += cost.system_tokens ?? 0;
          totalMessages += cost.messages_tokens ?? 0;
        } catch {
          // skip unreadable capture
        }
      }
    }

    return {
      name: s.name,
      avg_tools_tokens: Math.round(totalTools / count),
      avg_system_tokens: Math.round(totalSystem / count),
      avg_messages_tokens: Math.round(totalMessages / count),
      cache_hit_ratio: s.metrics.cache_hit_ratio,
      total_cost: s.total_cost,
      capture_paths: capturePaths,
      model: s.model,
      avg_ttfb_ms: s.timing?.avg_ttfb_ms,
      avg_duration_ms: s.timing ? Math.round(s.timing.total_model_time_ms / (count || 1)) : undefined,
      avg_rounds: s.avg_rounds,
      completion_rate: s.runs
        ? s.runs.filter((r) => r.completed).length / s.runs.length
        : undefined,
    };
  });

  const summary: CaptureSummary = {
    run_id: report.timestamp,
    timestamp: new Date().toISOString(),
    total_cost: report.total_cost,
    cache_hit_ratio: report.metrics.cache_hit_ratio,
    scenarios,
    report_dir: reportDir,
  };

  mkdirSync(reportDir, { recursive: true });
  writeFileSync(join(reportDir, "capture-summary.json"), JSON.stringify(summary, null, 2));
  return summary;
}

/**
 * Backup the files touched by a finding before applying it.
 * Files are stored in `<reportDir>/backups/<findingId>/<basename>`.
 * We also store a manifest so restoreFiles knows the original paths.
 */
export function backupFiles(reportDir: string, findingId: string, filePaths: string[]): void {
  const backupDir = join(reportDir, "backups", findingId);
  mkdirSync(backupDir, { recursive: true });

  const manifest: Record<string, string> = {};
  for (const filePath of filePaths) {
    if (!existsSync(filePath)) continue;
    const dest = join(backupDir, basename(filePath));
    writeFileSync(dest, readFileSync(filePath));
    manifest[basename(filePath)] = filePath;
  }
  writeFileSync(join(backupDir, "manifest.json"), JSON.stringify(manifest, null, 2));
}

/**
 * Restore files backed up for a finding. Reads manifest from the backup dir
 * and writes each file back to its original path.
 */
export function restoreFiles(reportDir: string, findingId: string): void {
  const backupDir = join(reportDir, "backups", findingId);
  const manifestPath = join(backupDir, "manifest.json");
  if (!existsSync(manifestPath)) return;

  const manifest: Record<string, string> = JSON.parse(readFileSync(manifestPath, "utf-8"));
  for (const [backupBasename, originalPath] of Object.entries(manifest)) {
    const src = join(backupDir, backupBasename);
    if (existsSync(src)) {
      writeFileSync(originalPath, readFileSync(src));
    }
  }
}

/** Serialise a FindingsReport and overwrite `<reportDir>/findings-report.json`. */
export function writeFindingsReport(reportDir: string, report: FindingsReport): void {
  mkdirSync(reportDir, { recursive: true });
  writeFileSync(join(reportDir, "findings-report.json"), JSON.stringify(report, null, 2));
}

/**
 * Check if a metric value satisfies a finding's metric contract.
 * Returns true if `after` is strictly better than `expected_after`.
 */
export function evaluateMetricContract(
  finding: Finding,
  report: RunReport,
): "confirmed" | "rolled_back" | "ineffective" {
  const { metric, before, expected_after } = finding.metric_contract;

  let after: number;
  if (metric === "total_cost") {
    after = report.total_cost;
  } else if (metric === "cache_hit_ratio") {
    after = report.metrics.cache_hit_ratio;
  } else if (metric === "cache_savings_pct") {
    after = report.cache_savings_pct ?? 0;
  } else {
    // tools_tokens — average across all scenarios
    const allScenarios = report.scenarios;
    const avgTools =
      allScenarios.reduce((sum, s) => {
        const vals = s.metrics.tools_count; // tools_count is used as proxy for tools_tokens check
        return sum + (vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : 0);
      }, 0) / (allScenarios.length || 1);
    after = avgTools;
  }

  // For cost/tokens: lower is better. For ratios: higher is better.
  const lowerIsBetter = metric === "total_cost" || metric === "tools_tokens";
  const improved = lowerIsBetter ? after <= expected_after : after >= expected_after;
  const worsened = lowerIsBetter ? after > before : after < before;

  if (improved) return "confirmed";
  if (worsened) return "rolled_back";
  return "ineffective";
}

/**
 * Detect if the loop has plateaued: returns true if the last `windowSize`
 * rounds each showed less than `threshold` fractional improvement.
 */
export function hasPlateaued(
  rounds: RoundSummary[],
  windowSize = 3,
  threshold = 0.01,
): boolean {
  if (rounds.length < windowSize + 1) return false;
  const window = rounds.slice(-windowSize);
  return window.every((r, i) => {
    const prev = rounds[rounds.length - windowSize + i - 1];
    if (!prev || prev.total_cost === 0) return false;
    const improvement = (prev.total_cost - r.total_cost) / prev.total_cost;
    return improvement < threshold;
  });
}

// ─── Report utilities ─────────────────────────────────────────────────────────

function compareReports(baseline: RunReport, current: RunReport): void {
  console.log("\n── Comparison: baseline vs current ─────────────────────────────");
  const b = baseline.metrics;
  const c = current.metrics;

  const cacheChange = c.cache_hit_ratio - b.cache_hit_ratio;
  const direction = cacheChange > 0 ? "improved" : cacheChange < 0 ? "regressed" : "unchanged";
  console.log(`  cache_hit_ratio: ${b.cache_hit_ratio.toFixed(2)} → ${c.cache_hit_ratio.toFixed(2)} (${direction})`);

  let regressionDetected = false;
  for (const bScenario of baseline.scenarios) {
    const cScenario = current.scenarios.find((s) => s.name === bScenario.name);
    if (!cScenario) continue;
    if (bScenario.pass && !cScenario.pass) {
      console.log(`  ⚠️  REGRESSION: '${bScenario.name}' was passing, now failing`);
      regressionDetected = true;
    } else if (!bScenario.pass && cScenario.pass) {
      console.log(`  ✅ IMPROVEMENT: '${bScenario.name}' now passing`);
    }
  }

  if (regressionDetected) {
    console.log("\n❌ Regression detected — fix before continuing.");
    process.exit(1);
  } else {
    console.log("✅ No regressions detected.");
  }
}

// ─── Scenario runner (shared) ─────────────────────────────────────────────────

/** Write raw exchange captures for a single run of a scenario. */
function writeCaptureFiles(
  dir: string,
  rawExchanges: Array<{ request_id: number; body: unknown; response?: unknown }>,
  records: import("./types.ts").InspectionRecord[],
): void {
  for (const raw of rawExchanges) {
    const inspection = records.find((r) => r.request_id === raw.request_id);
    const padded = String(raw.request_id).padStart(3, "0");
    writeFileSync(
      join(dir, `${padded}.json`),
      JSON.stringify({
        request_id: raw.request_id,
        body: raw.body,
        response: raw.response ?? inspection?.response,
        inspection,
        cost: inspection?.cost,
        timing: inspection?.timing,
      }, null, 2),
    );
  }
}

/** Run all scenarios against a proxy and return the RunReport + report dir. */
async function runScenarios(
  scenarios: Scenario[],
  mode: "mock" | "local" | "live",
  port: number,
  backendUrl: string | undefined,
  runReportDir: string,
  modelId: string,
  runsPerScenario: number = 1,
  provider?: ProviderConfig,
  worktreePath?: string,
): Promise<RunReport> {
  const { server, state, loadScenario, resetState } = provider
    ? createProxy({ provider, port })
    : createProxy({ mode, port, backendUrl });
  const proxyUrl = `http://localhost:${server.port}`;
  const modeLabel = provider?.type ?? mode;
  console.log(`[runner] proxy started on ${proxyUrl} mode=${modeLabel} model=${modelId}${provider ? ` provider=${provider.id}` : ""}`);

  const scenarioReports: ScenarioReport[] = [];

  for (const scenario of scenarios) {
    console.log(`\n── Scenario: ${scenario.name} ──`);

    // ── Two-run path (local/live) ─────────────────────────────────────────
    if (runsPerScenario >= 2) {
      type PerRun = {
        engineResult: Awaited<ReturnType<typeof runScenarioThroughEngine>>;
        records: typeof state.records;
        rawExchanges: typeof state.rawExchanges;
      };
      const perRunData: PerRun[] = [];

      for (let runIdx = 1; runIdx <= 2; runIdx++) {
        resetState();
        loadScenario(scenario);
        const engineResult = await runScenarioThroughEngine(
          scenario, proxyUrl, modelId, mode,
          scenario.codebase === "railyin" ? worktreePath : undefined,
        );
        const records = [...state.records];
        const rawExchanges = [...state.rawExchanges];
        perRunData.push({ engineResult, records, rawExchanges });

        if (rawExchanges.length > 0) {
          const capDir = provider
            ? join(runReportDir, "requests", provider.id, scenario.name, `run-${runIdx}`)
            : join(runReportDir, "requests", scenario.name, `run-${runIdx}`);
          mkdirSync(capDir, { recursive: true });
          writeCaptureFiles(capDir, rawExchanges, records);
        }
      }

      // Merge records from run 1 for assertion evaluation
      const records = perRunData[0].records;
      const allToolNames = [...new Set(perRunData.flatMap((r) => r.engineResult.toolNames))];
      const allCompleted = perRunData.every((r) => r.engineResult.completed);
      const extras = {
        toolNames: allToolNames,
        toolResults: perRunData.flatMap((r) => r.engineResult.toolResults),
        completed: allCompleted,
      };

      const assertionResults = evaluateAssertions(scenario.assertions, records, extras);
      const behavioralResults = evaluateBehavioralAssertions(scenario, records, { toolNames: allToolNames, completed: allCompleted });
      const allResults = [...assertionResults, ...behavioralResults];

      // Per-run cost aggregation
      const runsData = perRunData.map((r, i) => ({
        run: i + 1,
        rounds: r.records.length,
        total_cost: r.records.reduce((s, rec) => s + rec.cost.total_cost, 0),
        tool_names_called: r.engineResult.toolNames,
        completed: r.engineResult.completed,
      }));
      const totalCost = runsData.reduce((s, r) => s + r.total_cost, 0) / runsData.length;
      const allColdCost = perRunData.reduce(
        (s, { records: recs }) => s + recs.reduce((rs, r) => rs + coldCostFromRecord(r.cost, provider?.pricing), 0),
        0,
      ) / perRunData.length;
      const cacheSavings = allColdCost - totalCost;
      const cacheSavingsPct = allColdCost > 0 ? (cacheSavings / allColdCost) * 100 : 0;
      const cacheHitRatio = records.length > 0 ? records.filter((r) => r.cache_hit).length / records.length : 0;
      const roundCounts = runsData.map((r) => r.rounds);
      const avgRounds = roundCounts.reduce((s, v) => s + v, 0) / roundCounts.length;
      const roundVariance = Math.sqrt(
        roundCounts.reduce((s, v) => s + Math.pow(v - avgRounds, 2), 0) / roundCounts.length,
      );
      const timingAgg = perRunData[0].records.length > 0 ? {
        total_model_time_ms: perRunData[0].records.reduce((s, r) => s + (r.timing?.duration_ms ?? 0), 0),
        avg_ttfb_ms: perRunData[0].records.reduce((s, r) => s + (r.timing?.ttfb_ms ?? 0), 0) / (perRunData[0].records.length || 1),
        scenario_duration_ms: perRunData[0].records.reduce((s, r) => s + (r.timing?.duration_ms ?? 0), 0),
      } : undefined;

      console.log(`  Runs: ${runsData.map((r) => `run-${r.run}: ${r.rounds} rounds, ${r.completed ? "✓" : "✗"}`).join(" | ")}`);
      console.log(`  Avg cost: ${fmt(totalCost)} | cache_hit: ${cacheHitRatio.toFixed(2)}`);
      const runCosts = runsData.map((r) => r.total_cost);
      const avgRunCost = runCosts.reduce((s, v) => s + v, 0) / runCosts.length;
      const costVariance = Math.sqrt(
        runCosts.reduce((s, v) => s + Math.pow(v - avgRunCost, 2), 0) / runCosts.length,
      );
      const report: ScenarioReport = {
        name: scenario.name,
        pass: allResults.every((r) => r.pass),
        assertions: allResults,
        model: modelId,
        metrics: {
          tools_count: records.map((r) => r.tools_count),
          tools_hash_values: [...new Set(records.map((r) => r.tools_hash))],
          cache_hit_ratio: cacheHitRatio,
          max_tokens_values: records.map((r) => r.max_tokens),
        },
        total_cost: totalCost,
        all_cold_cost: allColdCost,
        cache_savings: cacheSavings,
        cache_savings_pct: cacheSavingsPct,
        runs: runsData,
        avg_rounds: avgRounds,
        rounds_variance: roundVariance,
        cost_variance: costVariance,
        min_rounds: Math.min(...roundCounts),
        max_rounds: Math.max(...roundCounts),
        timing: timingAgg,
      };
      scenarioReports.push(report);
      for (const a of allResults) {
        const icon = a.pass ? "✅" : "❌";
        console.log(`  ${icon} ${a.type}: ${a.message}`);
      }
      if (worktreePath && scenario.codebase === "railyin") {
        resetWorktree(worktreePath);
      }
      continue;
    }

    // ── Single-run path (mock) ────────────────────────────────────────────
    resetState();
    loadScenario(scenario);

    const engineResult = await runScenarioThroughEngine(
      scenario, proxyUrl, modelId, mode,
      scenario.codebase === "railyin" ? worktreePath : undefined,
    );
    const extras = { toolNames: engineResult.toolNames, toolResults: engineResult.toolResults };

    const records = [...state.records];
    const rawExchanges = [...state.rawExchanges];
    const assertionResults = evaluateAssertions(scenario.assertions, records, extras);

    let totalCost = 0;
    let allColdCost = 0;
    console.log(`  Cost breakdown:`);
    for (const r of records) {
      const cacheStatus = r.cache_hit ? "cache_read" : "cache_write";
      const prefixT = r.cost.tools_tokens + r.cost.system_tokens;
      console.log(
        `    req ${r.request_id} [${r.label}] ${r.model}: ${prefixT}T prefix (${cacheStatus}) + ${r.cost.messages_tokens}T delta = ${fmt(r.cost.total_cost)}`,
      );
      totalCost += r.cost.total_cost;
      allColdCost += coldCostFromRecord(r.cost, provider?.pricing);
    }
    const cacheSavings = allColdCost - totalCost;
    const cacheSavingsPct = allColdCost > 0 ? (cacheSavings / allColdCost) * 100 : 0;
    console.log(
      `  Scenario total: ${fmt(totalCost)} | cold: ${fmt(allColdCost)} | savings: ${fmt(cacheSavings)} (${cacheSavingsPct.toFixed(0)}%)`,
    );

    if (rawExchanges.length > 0) {
      const requestsDir = provider
        ? join(runReportDir, "requests", provider.id, scenario.name)
        : join(runReportDir, "requests", scenario.name);
      mkdirSync(requestsDir, { recursive: true });
      writeCaptureFiles(requestsDir, rawExchanges, records);
    }
    if (worktreePath && scenario.codebase === "railyin") {
      resetWorktree(worktreePath);
    }

    const totalHits = records.filter((r) => r.cache_hit).length;
    const cacheHitRatio = records.length > 0 ? totalHits / records.length : 0;

    const report: ScenarioReport = {
      name: scenario.name,
      pass: assertionResults.every((r) => r.pass),
      assertions: assertionResults,
      model: modelId,
      metrics: {
        tools_count: records.map((r) => r.tools_count),
        tools_hash_values: [...new Set(records.map((r) => r.tools_hash))],
        cache_hit_ratio: cacheHitRatio,
        max_tokens_values: records.map((r) => r.max_tokens),
      },
      total_cost: totalCost,
      all_cold_cost: allColdCost,
      cache_savings: cacheSavings,
      cache_savings_pct: cacheSavingsPct,
    };
    scenarioReports.push(report);

    for (const a of assertionResults) {
      const icon = a.pass ? "✅" : "❌";
      console.log(`  ${icon} ${a.type}: ${a.message}`);
    }
  }

  server.stop(true);

  const totalHitsAll = scenarioReports.reduce(
    (acc, s) => acc + s.metrics.cache_hit_ratio * s.metrics.tools_count.length,
    0,
  );
  const totalRequestsAll = scenarioReports.reduce((acc, s) => acc + s.metrics.tools_count.length, 0);
  const globalCacheHitRatio = totalRequestsAll > 0 ? totalHitsAll / totalRequestsAll : 0;

  const runTotalCost = scenarioReports.reduce((sum, s) => sum + s.total_cost, 0);
  const runAllColdCost = scenarioReports.reduce((sum, s) => sum + s.all_cold_cost, 0);
  const runCacheSavings = runAllColdCost - runTotalCost;
  const runCacheSavingsPct = runAllColdCost > 0 ? (runCacheSavings / runAllColdCost) * 100 : 0;

  const runReport: RunReport = {
    mode: provider?.type ?? mode,
    timestamp: new Date().toISOString(),
    pass: scenarioReports.every((s) => s.pass),
    scenarios: scenarioReports,
    metrics: { cache_hit_ratio: globalCacheHitRatio },
    total_cost: runTotalCost,
    all_cold_cost: runAllColdCost,
    cache_savings: runCacheSavings,
    cache_savings_pct: runCacheSavingsPct,
    model: modelId,
  };

  mkdirSync(runReportDir, { recursive: true });
  writeFileSync(join(runReportDir, "report.json"), JSON.stringify(runReport, null, 2));
  return runReport;
}


// ─── Provider orchestration ───────────────────────────────────────────────────

/**
 * Provider lifecycle wrapper around runScenarios.
 * Handles LM Studio setup, worktree creation/cleanup, and delegates
 * to runScenarios for the actual scenario execution.
 */
async function runScenariosForProvider(
  provider: ProviderConfig,
  config: ProvidersYaml,
  scenarios: Scenario[],
  port: number,
  runDir: string,
): Promise<RunReport> {
  const isMock = provider.type === "mock";
  const modelId = getModelId(provider);
  const runsPerScenario = config.runs_per_scenario ?? (isMock ? 1 : 2);
  const mode: "mock" | "local" | "live" = isMock
    ? "mock"
    : provider.type === "anthropic"
    ? "live"
    : "local";

  // LM Studio setup
  let teardown: (() => Promise<void>) | undefined;
  if (provider.type === "lmstudio") {
    const lmsAvailable = checkLmsCli();
    if (!lmsAvailable) {
      console.warn(`[runner] warning: lms CLI not found — skipping provider ${provider.id}`);
      return {
        mode,
        timestamp: new Date().toISOString(),
        pass: false,
        scenarios: [],
        metrics: { cache_hit_ratio: 0 },
        total_cost: 0,
        all_cold_cost: 0,
        cache_savings: 0,
        cache_savings_pct: 0,
        model: modelId,
      };
    }
    const setup = setupProvider(provider);
    teardown = setup.teardown;
  }

  // Worktree setup for non-mock providers with real-codebase scenarios
  let worktreePath: string | undefined;
  const hasCodebaseScenarios = scenarios.some((s) => s.codebase === "railyin");
  if (!isMock && hasCodebaseScenarios) {
    worktreePath = createWorktree(provider.id, config.stable_commit);
  }

  try {
    return await runScenarios(
      scenarios, mode, port, provider.backendUrl,
      runDir, modelId, runsPerScenario, provider, worktreePath,
    );
  } finally {
    if (worktreePath) {
      removeWorktree(worktreePath);
    }
    if (teardown) {
      await teardown();
    }
  }
}

/** Print a cross-provider comparison table to stdout. */
function printCrossProviderComparison(
  reports: Array<{ provider: ProviderConfig; report: RunReport }>,
): void {
  if (reports.length < 2) return;
  console.log("\n── Cross-Provider Comparison ───────────────────────────────────");
  console.log(`${"Provider".padEnd(18)} | ${"Cost".padEnd(8)} | ${"Cache Hit".padEnd(9)} | Scenarios | Pass`);
  console.log(`${"-".repeat(18)}-+-${"-".repeat(8)}-+-${"-".repeat(9)}-+-----------+-----`);
  for (const { provider, report } of reports) {
    const passCount = report.scenarios.filter((s) => s.pass).length;
    const pass = report.pass ? "✅" : "❌";
    console.log(
      `${provider.id.padEnd(18)} | ${fmt(report.total_cost).padEnd(8)} | ${report.metrics.cache_hit_ratio.toFixed(2).padEnd(9)} | ${String(passCount).padStart(4)}/${report.scenarios.length} | ${pass}`,
    );
  }
}

// ─── Auto loop ────────────────────────────────────────────────────────────────

/**
 * Autonomous refinement loop. Driven by phases:
 *  - baseline: run providers, write capture-summary.json and baseline-report.json, exit
 *  - backup:   backup source files for a finding before the AI applies it
 *  - evaluate: re-run providers, evaluate metric contract, confirm or rollback finding
 */
async function runAutoLoop(args: string[]): Promise<void> {
  const get = (flag: string) => {
    const i = args.indexOf(flag);
    return i !== -1 && i + 1 < args.length ? args[i + 1] : undefined;
  };

  const phase = get("--phase") ?? "baseline";
  const port = parseInt(get("--port") ?? "8999", 10);
  const backendUrl = get("--backend");
  const findingId = get("--finding-id");
  const findingsFile = get("--findings");
  const reportDir = get("--report-dir");
  const maxRoundsStr = get("--max-rounds");
  const maxRounds = maxRoundsStr ? parseInt(maxRoundsStr, 10) : Infinity;
  const providersFlag = get("--providers");
  // 8.2: Model configuration flags
  const localModelArg = get("--local-model");
  const liveModel = get("--live-model") ?? "anthropic/claude-sonnet-4-20250514";
  const skipLive = args.includes("--skip-live");
  const mockModel = "anthropic/claude-3-5-sonnet-20241022";

  /** Detect a running local model via `lms ps` (returns first loaded model id or undefined). */
  function detectLocalModel(): string | undefined {
    try {
      const result = spawnSync("lms", ["ps", "--json"], { encoding: "utf-8", timeout: 5000 });
      if (result.status === 0 && result.stdout.trim()) {
        const parsed = JSON.parse(result.stdout.trim());
        const models: Array<{ identifier?: string }> = Array.isArray(parsed) ? parsed : parsed.models ?? [];
        if (models.length > 0 && models[0].identifier) {
          return `lmstudio/${models[0].identifier}`;
        }
      }
    } catch { /* lms not installed or not running */ }
    // Fallback: try lms ps without --json (text output)
    try {
      const result = spawnSync("lms", ["ps"], { encoding: "utf-8", timeout: 5000 });
      if (result.status === 0 && result.stdout.trim()) {
        return "lmstudio/default";
      }
    } catch { /* ignore */ }
    return undefined;
  }

  if (phase === "baseline") {
    const runTimestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const runDir = join(REPORTS_DIR, `${runTimestamp}-auto`);
    const scenarios = loadAllScenarios();

    // ── Provider-based baseline (--providers flag, task 8.1) ───────────────
    if (providersFlag !== undefined) {
      let config: ProvidersYaml;
      try {
        config = loadProviders();
      } catch (err) {
        console.error(`[auto] Failed to load providers.yaml: ${err}`);
        process.exit(1);
      }
      const providers = selectProviders(config, providersFlag);

      // Apply --scenarios filter when provided
      const scenariosFlag2 = get("--scenarios");
      const filteredScenarios = scenariosFlag2
        ? scenarios.filter((s) => scenariosFlag2.split(",").map((n) => n.trim()).includes(s.name))
        : scenarios;
      if (filteredScenarios.length === 0) {
        console.error(`[auto] No scenarios matched for --scenarios ${scenariosFlag2}`);
        process.exit(1);
      }

      console.log(`[auto] baseline phase — providers: ${providers.map((p) => p.id).join(", ")}, scenarios: ${filteredScenarios.length}`);

      const allReports: Array<{ provider: ProviderConfig; report: RunReport }> = [];
      for (const provider of providers) {
        console.log(`\n[auto] provider: ${provider.id} (${provider.type})`);
        const providerDir = join(runDir, provider.id);
        try {
          const report = await runScenariosForProvider(provider, config, filteredScenarios, port, providerDir);
          allReports.push({ provider, report });
          writeCaptureSummary(providerDir, report);
        } catch (err) {
          console.warn(`[auto] provider ${provider.id} failed: ${err} — skipping`);
        }
      }

      const mockEntry = allReports.find((r) => r.provider.type === "mock");
      const BEHAVIORAL_ASSERTIONS = new Set(["must_call", "must_complete"]);
      if (mockEntry) {
        const hasMockStructuralFailures = mockEntry.report.scenarios.some((s) =>
          s.assertions.some((a) => !a.pass && !BEHAVIORAL_ASSERTIONS.has(a.type)),
        );
        if (hasMockStructuralFailures) {
          console.error("[auto] Baseline mock has failing structural assertions — fix before continuing");
          process.exit(1);
        }
      }

      // baseline-report.json: use mock if present, otherwise the first provider report
      const primaryEntry = mockEntry ?? allReports[0];
      if (!primaryEntry) {
        console.error("[auto] No providers ran successfully");
        process.exit(1);
      }
      writeFileSync(join(runDir, "baseline-report.json"), JSON.stringify(primaryEntry.report, null, 2));
      const analysis = generateAnalysis(runDir);
      printCrossProviderComparison(allReports);

      console.log(`\n[auto] baseline complete (provider-based)`);
      console.log(`  report-dir: ${runDir}`);
      for (const { provider: p, report } of allReports) {
        console.log(`  ${p.id}: ${fmt(report.total_cost)} (${p.type})`);
      }
      if (analysis.summary.live_vs_mock_cost_ratio !== undefined) {
        console.log(`  live/mock cost ratio: ${analysis.summary.live_vs_mock_cost_ratio}x`);
      }
      console.log(`\n[auto] Next: generate findings and write them to ${join(runDir, "findings.json")}`);
      const providersHint = ` --providers ${providersFlag}`;
      const scenariosHint = scenariosFlag2 ? ` --scenarios ${scenariosFlag2}` : "";
      console.log(`  Then run: bun refinement/runner.ts --mode auto --phase evaluate --finding-id <id> --findings ${join(runDir, "findings.json")} --report-dir ${runDir}${providersHint}${scenariosHint}`);
      return;
    }

    console.log(`[auto] baseline phase — running ${scenarios.length} scenario(s) across modes`);

    // ── Mock (always runs, 1 run per scenario) ─────────────────────────────
    console.log("\n[auto] mode: mock");
    const mockDir = join(runDir, "mock");
    const mockReport = await runScenarios(scenarios, "mock", port, backendUrl, mockDir, mockModel, 1);
    const BEHAVIORAL_ASSERTIONS_2 = new Set(["must_call", "must_complete"]);
    const hasMockStructuralFailures2 = mockReport.scenarios.some((s) =>
      s.assertions.some((a) => !a.pass && !BEHAVIORAL_ASSERTIONS_2.has(a.type)),
    );
    if (hasMockStructuralFailures2) {
      console.error("[auto] Baseline mock has failing structural assertions — fix before continuing");
      process.exit(1);
    }
    writeCaptureSummary(mockDir, mockReport);

    // ── Local (2 runs per scenario, skip if no model) ─────────────────────
    const localModel = localModelArg ?? detectLocalModel();
    let localReport: RunReport | undefined;
    if (localModel) {
      console.log(`\n[auto] mode: local (model: ${localModel})`);
      const localDir = join(runDir, "local");
      try {
        localReport = await runScenarios(scenarios, "local", port, backendUrl, localDir, localModel, 2);
        writeCaptureSummary(localDir, localReport);
      } catch (err) {
        console.warn(`[auto] local mode failed: ${err} — skipping`);
      }
    } else {
      console.log("[auto] no local model available — skipping local collection (use --local-model <id>)");
    }

    // ── Live (2 runs per scenario, skip if --skip-live) ───────────────────
    let liveReport: RunReport | undefined;
    if (!skipLive) {
      console.log(`\n[auto] mode: live (model: ${liveModel})`);
      const liveDir = join(runDir, "live");
      try {
        liveReport = await runScenarios(scenarios, "live", port, backendUrl, liveDir, liveModel, 2);
        writeCaptureSummary(liveDir, liveReport);
      } catch (err) {
        console.warn(`[auto] live mode failed: ${err} — skipping`);
      }
    } else {
      console.log("[auto] --skip-live set — skipping live collection");
    }

    // ── Write combined baseline (mock is primary for metric gating) ───────
    writeFileSync(join(runDir, "baseline-report.json"), JSON.stringify(mockReport, null, 2));
    const backendFlag = backendUrl ? ` --backend ${backendUrl}` : "";
    const localModelFlag = localModel ? ` --local-model ${localModel}` : "";

    console.log(`\n[auto] baseline complete`);
    console.log(`  report-dir: ${runDir}`);
    console.log(`  mock:  ${fmt(mockReport.total_cost)} (${mockReport.metrics.cache_hit_ratio.toFixed(2)} hit)`);
    if (localReport) console.log(`  local: ${fmt(localReport.total_cost)}`);
    if (liveReport) console.log(`  live:  ${fmt(liveReport.total_cost)}`);

    // 9.6: Write cross-mode analysis.json
    const analysis = generateAnalysis(runDir);
    console.log(`  analysis: ${join(runDir, "analysis.json")} (modes: ${analysis.modes_collected.join(", ")})`);
    if (analysis.summary.live_vs_mock_cost_ratio !== undefined) {
      console.log(`  live/mock cost ratio: ${analysis.summary.live_vs_mock_cost_ratio}x`);
    }

    console.log(`\n[auto] Next: generate findings and write them to ${join(runDir, "findings.json")}`);
    console.log(`  Then run: bun refinement/runner.ts --mode auto --phase evaluate --finding-id <id> --findings ${join(runDir, "findings.json")} --report-dir ${runDir}${localModelFlag}${backendFlag}`);
    return;
  }

  if (phase === "backup") {
    if (!findingId || !findingsFile || !reportDir) {
      console.error("[auto] --phase backup requires --finding-id, --findings, --report-dir");
      process.exit(1);
    }
    const findings: Finding[] = JSON.parse(readFileSync(findingsFile, "utf-8"));
    const finding = findings.find((f) => f.id === findingId);
    if (!finding) {
      console.error(`[auto] finding ${findingId} not found in ${findingsFile}`);
      process.exit(1);
    }
    if (!finding.evidence.doc_reference) {
      console.error(`[auto] finding ${findingId} has no doc_reference — not applying`);
      process.exit(1);
    }

    backupFiles(reportDir, findingId, [finding.source.file]);
    finding.status = "applied";
    writeFileSync(findingsFile, JSON.stringify(findings, null, 2));
    console.log(`[auto] backed up ${finding.source.file} for ${findingId} → status: applied`);
    console.log(`[auto] Now apply the code change, then run --phase evaluate`);
    return;
  }

  if (phase === "evaluate") {
    if (!findingId || !findingsFile || !reportDir) {
      console.error("[auto] --phase evaluate requires --finding-id, --findings, --report-dir");
      process.exit(1);
    }
    const findings: Finding[] = JSON.parse(readFileSync(findingsFile, "utf-8"));
    const finding = findings.find((f) => f.id === findingId);
    if (!finding) {
      console.error(`[auto] finding ${findingId} not found`);
      process.exit(1);
    }
    const baselineReport: RunReport = JSON.parse(
      readFileSync(join(reportDir, "baseline-report.json"), "utf-8"),
    );
    // Load per-mode baselines if they exist (from the baseline phase subdirs)
    const localBaselineReport: RunReport | undefined = existsSync(join(reportDir, "local", "report.json"))
      ? JSON.parse(readFileSync(join(reportDir, "local", "report.json"), "utf-8"))
      : undefined;
    const liveBaselineReport: RunReport | undefined = existsSync(join(reportDir, "live", "report.json"))
      ? JSON.parse(readFileSync(join(reportDir, "live", "report.json"), "utf-8"))
      : undefined;

    const evalDir = join(reportDir, `eval-${findingId}`);
    const allScenariosEval = loadAllScenarios();
    const scenariosFlagEval = get("--scenarios");
    const filteredScenariosEval = scenariosFlagEval
      ? allScenariosEval.filter((s) => scenariosFlagEval.split(",").map((n) => n.trim()).includes(s.name))
      : allScenariosEval;

    // ── Shared regression checker ──────────────────────────────────────────
    function checkRegressions(baseline: RunReport, eval_: RunReport, label: string): boolean {
      let found = false;
      for (const baseSc of baseline.scenarios) {
        const evalSc = eval_.scenarios.find((s) => s.name === baseSc.name);
        if (!evalSc) continue;
        for (const baseA of baseSc.assertions) {
          if (!baseA.pass) continue;
          const evalA = evalSc.assertions.find((a) => a.type === baseA.type);
          if (evalA && !evalA.pass) {
            console.log(`  ⚠️  [${label}] assertion regression: ${baseA.type} in '${baseSc.name}'`);
            found = true;
          }
        }
      }
      return found;
    }

    // ── Provider-based evaluate (--providers flag) ─────────────────────────
    if (providersFlag !== undefined) {
      let config: ProvidersYaml;
      try {
        config = loadProviders();
      } catch (err) {
        console.error(`[auto] Failed to load providers.yaml: ${err}`);
        process.exit(1);
      }
      const evalProviders = selectProviders(config, providersFlag);

      let assertionRegression = false;
      let primaryEvalReport: RunReport | undefined;

      for (const provider of evalProviders) {
        const providerBaselinePath = join(reportDir, provider.id, "report.json");
        if (!existsSync(providerBaselinePath)) {
          console.warn(`[auto] no baseline found for ${provider.id} at ${providerBaselinePath} — skipping`);
          continue;
        }
        const providerBaseline: RunReport = JSON.parse(readFileSync(providerBaselinePath, "utf-8"));

        console.log(`[auto] evaluate phase for ${findingId} — ${provider.id} (${provider.type})`);
        const providerEvalDir = join(evalDir, provider.id);
        const evalReport = await runScenariosForProvider(provider, config, filteredScenariosEval, port, providerEvalDir);
        writeCaptureSummary(providerEvalDir, evalReport);

        if (checkRegressions(providerBaseline, evalReport, provider.id)) {
          assertionRegression = true;
        }
        if (provider.type !== "mock") {
          primaryEvalReport = evalReport;
        }
      }

      if (!primaryEvalReport) {
        console.error("[auto] No provider eval report produced — check --providers flag and baselines");
        process.exit(1);
      }

      let outcome: "confirmed" | "rolled_back" | "ineffective";
      if (assertionRegression) {
        outcome = "rolled_back";
        console.log(`[auto] ${findingId} → rolled_back (assertion regression in one or more providers)`);
      } else {
        outcome = evaluateMetricContract(finding, primaryEvalReport);
        console.log(`[auto] ${findingId} → ${outcome} (metric: ${finding.metric_contract.metric} before: ${finding.metric_contract.before.toFixed(4)} → after: ${primaryEvalReport.total_cost.toFixed(4)})`);
      }

      if (outcome === "rolled_back") {
        restoreFiles(reportDir, findingId);
        console.log(`[auto] restored files for ${findingId}`);
      }

      finding.status = outcome;

      // Load or create findings report
      const findingsReportPath2 = join(reportDir, "findings-report.json");
      let findingsReport2: FindingsReport;
      if (existsSync(findingsReportPath2)) {
        findingsReport2 = JSON.parse(readFileSync(findingsReportPath2, "utf-8"));
      } else {
        const baselineCost2 = baselineReport.total_cost;
        findingsReport2 = {
          run_id: baselineReport.timestamp,
          timestamp: new Date().toISOString(),
          mode: "auto",
          rounds: [],
          findings: findings,
          summary: {
            confirmed: 0,
            rolled_back: 0,
            ineffective: 0,
            total_cost_before: baselineCost2,
            total_cost_after: baselineCost2,
            improvement_pct: 0,
          },
        };
      }
      findingsReport2.findings = findings;
      const confirmed2 = findings.filter((f) => f.status === "confirmed").length;
      const rolledBack2 = findings.filter((f) => f.status === "rolled_back").length;
      const ineffective2 = findings.filter((f) => f.status === "ineffective").length;
      const costAfter2 = primaryEvalReport.total_cost;
      const costBefore2 = findingsReport2.summary.total_cost_before;
      const improvementPct2 = costBefore2 > 0 ? ((costBefore2 - costAfter2) / costBefore2) * 100 : 0;
      const roundNum2 = findingsReport2.rounds.length + 1;
      findingsReport2.rounds.push({ round: roundNum2, findings_attempted: 1, findings_confirmed: outcome === "confirmed" ? 1 : 0, total_cost: costAfter2 });
      findingsReport2.summary = { ...findingsReport2.summary, confirmed: confirmed2, rolled_back: rolledBack2, ineffective: ineffective2, total_cost_after: costAfter2, improvement_pct: improvementPct2 };
      findingsReport2.timestamp = new Date().toISOString();
      writeFindingsReport(reportDir, findingsReport2);
      writeFileSync(findingsFile, JSON.stringify(findings, null, 2));

      if (hasPlateaued(findingsReport2.rounds)) {
        console.log(`[auto] plateau detected — last 3 rounds each < 1% improvement. Stopping.`);
        process.exit(0);
      }
      if (findingsReport2.rounds.length >= maxRounds) {
        console.log(`[auto] max-rounds (${maxRounds}) reached. Stopping.`);
        process.exit(0);
      }
      if (outcome === "rolled_back") {
        process.exit(2);
      }
      return;
    }

    // ── Legacy mock/local/live evaluate path ───────────────────────────────
    // Mock eval (always)
    console.log(`[auto] evaluate phase for ${findingId} — mock`);
    const evalReport = await runScenarios(filteredScenariosEval, "mock", port, backendUrl, evalDir, mockModel, 1);

    // ── Local eval (if baseline exists and model available) ────────────────
    const localModel = localModelArg ?? detectLocalModel();
    let localEvalReport: RunReport | undefined;
    if (localBaselineReport && localModel) {
      console.log(`[auto] evaluate phase for ${findingId} — local (${localModel})`);
      try {
        localEvalReport = await runScenarios(filteredScenariosEval, "local", port, backendUrl, join(evalDir, "local"), localModel, 2);
      } catch (err) {
        console.warn(`[auto] local eval failed: ${err} — skipping`);
      }
    }

    // ── Live eval (if baseline exists and not --skip-live) ─────────────────
    let liveEvalReport: RunReport | undefined;
    if (liveBaselineReport && !skipLive) {
      console.log(`[auto] evaluate phase for ${findingId} — live (${liveModel})`);
      try {
        liveEvalReport = await runScenarios(filteredScenariosEval, "live", port, backendUrl, join(evalDir, "live"), liveModel, 2);
      } catch (err) {
        console.warn(`[auto] live eval failed: ${err} — skipping`);
      }
    }

    let assertionRegression = checkRegressions(baselineReport, evalReport, "mock");
    if (localEvalReport && localBaselineReport) {
      assertionRegression = checkRegressions(localBaselineReport, localEvalReport, "local") || assertionRegression;
    }
    if (liveEvalReport && liveBaselineReport) {
      assertionRegression = checkRegressions(liveBaselineReport, liveEvalReport, "live") || assertionRegression;
    }

    let outcome: "confirmed" | "rolled_back" | "ineffective";
    if (assertionRegression) {
      outcome = "rolled_back";
      console.log(`[auto] ${findingId} → rolled_back (assertion regression in one or more modes)`);
    } else {
      outcome = evaluateMetricContract(finding, evalReport);
      console.log(`[auto] ${findingId} → ${outcome} (metric: ${finding.metric_contract.metric} mock: ${finding.metric_contract.before.toFixed(4)} → ${evalReport.total_cost.toFixed(4)})`);
    }

    if (outcome === "rolled_back") {
      restoreFiles(reportDir, findingId);
      console.log(`[auto] restored files for ${findingId}`);
    }

    finding.status = outcome;

    // Load or create findings report
    const findingsReportPath = join(reportDir, "findings-report.json");
    let findingsReport: FindingsReport;
    if (existsSync(findingsReportPath)) {
      findingsReport = JSON.parse(readFileSync(findingsReportPath, "utf-8"));
    } else {
      const baselineCost = baselineReport.total_cost;
      findingsReport = {
        run_id: baselineReport.timestamp,
        timestamp: new Date().toISOString(),
        mode: "auto",
        rounds: [],
        findings: findings,
        summary: {
          confirmed: 0,
          rolled_back: 0,
          ineffective: 0,
          total_cost_before: baselineCost,
          total_cost_after: baselineCost,
          improvement_pct: 0,
        },
      };
    }

    // Update findings in report
    findingsReport.findings = findings;
    const confirmed = findings.filter((f) => f.status === "confirmed").length;
    const rolledBack = findings.filter((f) => f.status === "rolled_back").length;
    const ineffective = findings.filter((f) => f.status === "ineffective").length;
    const costAfter = evalReport.total_cost;
    const costBefore = findingsReport.summary.total_cost_before;
    const improvementPct = costBefore > 0 ? ((costBefore - costAfter) / costBefore) * 100 : 0;

    // Add round summary (one round = one evaluate call)
    const roundNum = findingsReport.rounds.length + 1;
    const roundSummary: RoundSummary = {
      round: roundNum,
      findings_attempted: 1,
      findings_confirmed: outcome === "confirmed" ? 1 : 0,
      total_cost: costAfter,
    };
    findingsReport.rounds.push(roundSummary);
    findingsReport.summary = {
      ...findingsReport.summary,
      confirmed,
      rolled_back: rolledBack,
      ineffective,
      total_cost_after: costAfter,
      improvement_pct: improvementPct,
    };
    findingsReport.timestamp = new Date().toISOString();

    // Write findings report immediately (task 4.2)
    writeFindingsReport(reportDir, findingsReport);
    writeFileSync(findingsFile, JSON.stringify(findings, null, 2));

    // Plateau detection (task 5.6)
    if (hasPlateaued(findingsReport.rounds)) {
      console.log(`[auto] plateau detected — last 3 rounds each < 1% improvement. Stopping.`);
      console.log(`[auto] findings-report written to ${join(reportDir, "findings-report.json")}`);
      process.exit(0);
    }

    // Max rounds check (task 5.7)
    if (findingsReport.rounds.length >= maxRounds) {
      console.log(`[auto] max-rounds (${maxRounds}) reached. Stopping.`);
      process.exit(0);
    }

    if (outcome === "rolled_back") {
      process.exit(2); // exit 2 signals rollback to skill
    }
    return;
  }

  console.error(`[auto] Unknown phase: ${phase}. Use: baseline | backup | evaluate`);
  process.exit(1);
}

// ─── Main run ─────────────────────────────────────────────────────────────────

async function run(): Promise<void> {
  const args = process.argv.slice(2);
  const get = (flag: string) => {
    const i = args.indexOf(flag);
    return i !== -1 && i + 1 < args.length ? args[i + 1] : undefined;
  };

  const mode = (get("--mode") ?? "mock") as ProxyMode;

  // Route auto mode to the autonomous loop handler
  if (mode === "auto") {
    await runAutoLoop(args);
    return;
  }

  const port = parseInt(get("--port") ?? "8999", 10);
  const backendUrl = get("--backend");
  const compareFile = get("--compare");
  const providersFlag = get("--providers");
  const scenariosFlag = get("--scenarios");

  // ── Provider-based path (--providers flag, tasks 6.1-6.4) ─────────────────
  if (providersFlag !== undefined) {
    let config: ProvidersYaml;
    try {
      config = loadProviders();
    } catch (err) {
      console.error(`[runner] Failed to load providers.yaml: ${err}`);
      process.exit(1);
    }

    const providers = selectProviders(config, providersFlag);
    if (providers.length === 0) {
      console.error("[runner] No providers selected");
      process.exit(1);
    }

    const allScenarios = loadAllScenarios();
    const scenarios: Scenario[] = scenariosFlag
      ? allScenarios.filter((s) => scenariosFlag.split(",").map((n) => n.trim()).includes(s.name))
      : allScenarios;

    if (scenarios.length === 0) {
      console.error(`[runner] No scenarios matched for --scenarios ${scenariosFlag}`);
      process.exit(1);
    }

    console.log(`[runner] providers: ${providers.map((p) => p.id).join(", ")}`);
    console.log(`[runner] scenarios: ${scenarios.map((s) => s.name).join(", ")}`);

    const runTimestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const runDir = join(REPORTS_DIR, `${runTimestamp}-providers`);

    const providerReports: Array<{ provider: ProviderConfig; report: RunReport }> = [];
    for (const provider of providers) {
      console.log(`\n[runner] ── provider: ${provider.id} (${provider.type}) ──`);
      const providerDir = join(runDir, provider.id);
      const report = await runScenariosForProvider(provider, config, scenarios, port, providerDir);
      providerReports.push({ provider, report });
    }

    printCrossProviderComparison(providerReports);

    if (compareFile) {
      const baseline: RunReport = JSON.parse(readFileSync(compareFile, "utf-8"));
      compareReports(baseline, providerReports[0].report);
    }

    if (!providerReports.every((r) => r.report.pass)) {
      process.exit(1);
    }
    return;
  }

  // ── Legacy path (--mode flag, task 6.5 backward compat) ────────────────────
  const scenarioName = get("--scenario");
  const scenarios: Scenario[] = scenarioName
    ? [loadNamedScenario(scenarioName)]
    : loadAllScenarios();

  console.log(`[runner] running ${scenarios.length} scenario(s)`);

  const runTimestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const runReportDir = join(REPORTS_DIR, `${runTimestamp}-${mode}`);

  const modelId = get("--model")
    ?? (mode === "local" ? (get("--local-model") ?? "lmstudio/default") : "anthropic/claude-3-5-sonnet-20241022");
  const runsPerScenario = (mode === "local" || mode === "live") ? 2 : 1;
  const runReport = await runScenarios(scenarios, mode, port, backendUrl, runReportDir, modelId, runsPerScenario);

  const reportFile = join(runReportDir, "report.json");
  console.log(`\n[runner] report written to ${reportFile}`);
  console.log(
    `[runner] run total: ${fmt(runReport.total_cost)} | cold: ${fmt(runReport.all_cold_cost)} | savings: ${fmt(runReport.cache_savings)} (${runReport.cache_savings_pct.toFixed(0)}%)`,
  );

  const passCount = runReport.scenarios.filter((s) => s.pass).length;
  console.log(`[runner] ${passCount}/${runReport.scenarios.length} scenarios passed`);

  if (compareFile) {
    const baseline: RunReport = JSON.parse(readFileSync(compareFile, "utf-8"));
    compareReports(baseline, runReport);
  }

  if (!runReport.pass) {
    process.exit(1);
  }
}

if (import.meta.main) {
  run().catch((e) => {
    console.error("[runner] fatal:", e);
    process.exit(1);
  });
}
