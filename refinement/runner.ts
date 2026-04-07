/**
 * refinement/runner.ts
 *
 * CLI orchestrator: starts the proxy, loads scenarios, runs all modes through
 * the engine headlessly, evaluates assertions, writes per-request JSON captures,
 * generates JSON reports, and optionally compares against a baseline report.
 *
 * Usage:
 *   bun refinement/runner.ts --mode mock
 *   bun refinement/runner.ts --mode mock --scenario single-agent-multi-turn
 *   bun refinement/runner.ts --mode mock --compare refinement/reports/baseline/report.json
 */

import { writeFileSync, readFileSync, mkdirSync } from "fs";
import { join } from "path";
import { createProxy } from "./proxy.ts";
import { loadAllScenarios, loadNamedScenario } from "./scenarios.ts";
import { evaluateAssertions } from "./assertions.ts";
import { runScenarioThroughEngine } from "./engine-runner.ts";
import type { CostEstimate, ProxyMode, RunReport, ScenarioReport, Scenario } from "./types.ts";

const REPORTS_DIR = join(import.meta.dir, "reports");

// ─── Cost helpers ─────────────────────────────────────────────────────────────

/** Recompute what a request would cost if the cache was cold (cache_write instead of cache_read). */
function coldCostFromRecord(c: CostEstimate): number {
  const prefixTokens = c.tools_tokens + c.system_tokens;
  return (
    (prefixTokens / 1_000_000) * 6.0 +
    (c.messages_tokens / 1_000_000) * 3.0 +
    (c.output_tokens / 1_000_000) * 15.0
  );
}

function fmt(n: number): string {
  return `$${n.toFixed(4)}`;
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

// ─── Main run ─────────────────────────────────────────────────────────────────

async function run(): Promise<void> {
  const args = process.argv.slice(2);
  const get = (flag: string) => {
    const i = args.indexOf(flag);
    return i !== -1 && i + 1 < args.length ? args[i + 1] : undefined;
  };

  const mode = (get("--mode") ?? "mock") as ProxyMode;
  const port = parseInt(get("--port") ?? "8999", 10);
  const backendUrl = get("--backend");
  const scenarioName = get("--scenario");
  const compareFile = get("--compare");

  // Start proxy
  const { server, state, loadScenario, resetState } = createProxy({ mode, port, backendUrl });
  const proxyUrl = `http://localhost:${server.port}`;
  console.log(`[runner] proxy started on ${proxyUrl} mode=${mode}`);

  // Load scenarios
  const scenarios: Scenario[] = scenarioName
    ? [loadNamedScenario(scenarioName)]
    : loadAllScenarios(mode);

  console.log(`[runner] running ${scenarios.length} scenario(s)`);

  // Run timestamp used for the report directory name
  const runTimestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const runReportDir = join(REPORTS_DIR, `${runTimestamp}-${mode}`);

  const scenarioReports: ScenarioReport[] = [];
  const modelId = mode === "local"
    ? "anthropic/qwen3.5-9b"
    : "anthropic/claude-3-5-sonnet-20241022";

  for (const scenario of scenarios) {
    console.log(`\n── Scenario: ${scenario.name} ──`);
    resetState();
    loadScenario(scenario);

    console.log(`[runner] running '${scenario.name}' through engine (${mode} mode)`);
    const engineResult = await runScenarioThroughEngine(scenario, proxyUrl, modelId);
    const extras = {
      toolNames: engineResult.toolNames,
      toolResults: engineResult.toolResults,
    };

    const records = [...state.records];
    const rawRequests = [...state.rawRequests];
    const assertionResults = evaluateAssertions(scenario.assertions, records, extras);

    // ── Per-request console output and cost aggregation ──
    let totalCost = 0;
    let allColdCost = 0;
    console.log(`  Cost breakdown:`);
    for (const r of records) {
      const cacheStatus = r.cache_hit ? "cache_read" : "cache_write";
      const prefixT = r.cost.tools_tokens + r.cost.system_tokens;
      console.log(`    req ${r.request_id} [${r.label}] ${r.model}: ${prefixT}T prefix (${cacheStatus}) + ${r.cost.messages_tokens}T delta = ${fmt(r.cost.total_cost)}`);
      totalCost += r.cost.total_cost;
      allColdCost += coldCostFromRecord(r.cost);
    }
    const cacheSavings = allColdCost - totalCost;
    const cacheSavingsPct = allColdCost > 0 ? (cacheSavings / allColdCost) * 100 : 0;
    console.log(`  Scenario total: ${fmt(totalCost)} | cold: ${fmt(allColdCost)} | savings: ${fmt(cacheSavings)} (${cacheSavingsPct.toFixed(0)}%)`);

    // ── Write per-request JSON captures ──
    if (rawRequests.length > 0) {
      const requestsDir = join(runReportDir, "requests", scenario.name);
      mkdirSync(requestsDir, { recursive: true });
      for (const raw of rawRequests) {
        const inspection = records.find((r) => r.request_id === raw.request_id);
        const padded = String(raw.request_id).padStart(3, "0");
        writeFileSync(
          join(requestsDir, `${padded}.json`),
          JSON.stringify({ request_id: raw.request_id, body: raw.body, inspection, cost: inspection?.cost }, null, 2),
        );
      }
    }

    const totalHits = records.filter((r) => r.cache_hit).length;
    const cacheHitRatio = records.length > 0 ? totalHits / records.length : 0;

    const report: ScenarioReport = {
      name: scenario.name,
      pass: assertionResults.every((r) => r.pass),
      assertions: assertionResults,
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

  const totalHitsAll = scenarioReports.reduce((acc, s) => acc + s.metrics.cache_hit_ratio * s.metrics.tools_count.length, 0);
  const totalRequestsAll = scenarioReports.reduce((acc, s) => acc + s.metrics.tools_count.length, 0);
  const globalCacheHitRatio = totalRequestsAll > 0 ? totalHitsAll / totalRequestsAll : 0;

  const runTotalCost = scenarioReports.reduce((sum, s) => sum + s.total_cost, 0);
  const runAllColdCost = scenarioReports.reduce((sum, s) => sum + s.all_cold_cost, 0);
  const runCacheSavings = runAllColdCost - runTotalCost;
  const runCacheSavingsPct = runAllColdCost > 0 ? (runCacheSavings / runAllColdCost) * 100 : 0;

  const overallPass = scenarioReports.every((s) => s.pass);
  const runReport: RunReport = {
    mode,
    timestamp: new Date().toISOString(),
    pass: overallPass,
    scenarios: scenarioReports,
    metrics: { cache_hit_ratio: globalCacheHitRatio },
    total_cost: runTotalCost,
    all_cold_cost: runAllColdCost,
    cache_savings: runCacheSavings,
    cache_savings_pct: runCacheSavingsPct,
  };

  // Write report.json into the run directory
  mkdirSync(runReportDir, { recursive: true });
  const reportFile = join(runReportDir, "report.json");
  writeFileSync(reportFile, JSON.stringify(runReport, null, 2));
  console.log(`\n[runner] report written to ${reportFile}`);
  console.log(`[runner] run total: ${fmt(runTotalCost)} | cold: ${fmt(runAllColdCost)} | savings: ${fmt(runCacheSavings)} (${runCacheSavingsPct.toFixed(0)}%)`);

  const passCount = scenarioReports.filter((s) => s.pass).length;
  console.log(`[runner] ${passCount}/${scenarioReports.length} scenarios passed`);

  // Compare with baseline if requested
  if (compareFile) {
    const baseline: RunReport = JSON.parse(readFileSync(compareFile, "utf-8"));
    compareReports(baseline, runReport);
  }

  if (!overallPass) {
    process.exit(1);
  }
}

if (import.meta.main) {
  run().catch((e) => {
    console.error("[runner] fatal:", e);
    process.exit(1);
  });
}
