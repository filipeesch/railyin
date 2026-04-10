/**
 * refinement/analysis.ts
 *
 * Cross-mode analysis: reads mock, local, and live RunReports from a run directory
 * and produces analysis.json comparing token costs, tool sequences, round counts,
 * timing, and completion rates.
 *
 * Group 9 tasks: 9.1 – 9.6
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import type { RunReport } from "./types.ts";

// ─── Analysis types ───────────────────────────────────────────────────────────

export interface ScenarioAnalysis {
  name: string;
  mock?: {
    request_count: number;
    total_cost: number;
    cache_hit_ratio: number;
  };
  local?: {
    avg_rounds: number;
    min_rounds: number;
    max_rounds: number;
    rounds_variance: number;
    completion_rate: number;
    tool_names_observed: string[];
    avg_ttfb_ms?: number;
  };
  live?: {
    avg_rounds: number;
    min_rounds: number;
    max_rounds: number;
    rounds_variance: number;
    completion_rate: number;
    total_cost: number;
    tool_names_observed: string[];
    avg_ttfb_ms?: number;
  };
  /** Whether local and live agree on which tools were called. */
  tool_sequence_agreement?: boolean;
  /** Fraction of tools in common between local and live (Jaccard similarity). */
  tool_jaccard?: number;
}

export interface CrossModeComparison {
  /** Ratio of live total cost to mock total cost (how much more real calls cost). */
  live_vs_mock_cost_ratio?: number;
  /** Average difference in round counts between local and live. */
  avg_round_count_delta?: number;
  /** Percentage of scenarios where local and live agree on tool calls. */
  tool_agreement_pct?: number;
  /** Average TTFB across local scenarios in ms. */
  avg_local_ttfb_ms?: number;
  /** Average TTFB across live scenarios in ms. */
  avg_live_ttfb_ms?: number;
  /** Completion rate for local mode across all scenarios. */
  local_completion_rate?: number;
  /** Completion rate for live mode across all scenarios. */
  live_completion_rate?: number;
}

export interface Analysis {
  generated_at: string;
  run_dir: string;
  modes_collected: string[];
  scenarios: ScenarioAnalysis[];
  summary: CrossModeComparison;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function jaccardSimilarity(a: string[], b: string[]): number {
  const setA = new Set(a);
  const setB = new Set(b);
  const intersection = [...setA].filter((x) => setB.has(x)).length;
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 1 : intersection / union;
}

function tryReadReport(path: string): RunReport | undefined {
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as RunReport;
  } catch {
    return undefined;
  }
}

// ─── Main function ────────────────────────────────────────────────────────────

/**
 * Generate cross-mode analysis from an auto run directory.
 * Reads `{runDir}/mock/report.json`, `{runDir}/local/report.json`, `{runDir}/live/report.json`.
 * Writes `{runDir}/analysis.json`.
 *
 * @returns the generated Analysis object
 */
export function generateAnalysis(runDir: string): Analysis {
  const mockReport = tryReadReport(join(runDir, "mock", "report.json"));
  const localReport = tryReadReport(join(runDir, "local", "report.json"));
  const liveReport = tryReadReport(join(runDir, "live", "report.json"));

  const modesCollected: string[] = [];
  if (mockReport) modesCollected.push("mock");
  if (localReport) modesCollected.push("local");
  if (liveReport) modesCollected.push("live");

  // Collect all unique scenario names across modes
  const allNames = new Set<string>([
    ...(mockReport?.scenarios.map((s) => s.name) ?? []),
    ...(localReport?.scenarios.map((s) => s.name) ?? []),
    ...(liveReport?.scenarios.map((s) => s.name) ?? []),
  ]);

  const scenarioAnalyses: ScenarioAnalysis[] = [];

  for (const name of allNames) {
    const mock = mockReport?.scenarios.find((s) => s.name === name);
    const local = localReport?.scenarios.find((s) => s.name === name);
    const live = liveReport?.scenarios.find((s) => s.name === name);

    const sa: ScenarioAnalysis = { name };

    // ── Mock data ──────────────────────────────────────────────────────────
    if (mock) {
      sa.mock = {
        request_count: mock.metrics.tools_count.length,
        total_cost: mock.total_cost,
        cache_hit_ratio: mock.metrics.cache_hit_ratio,
      };
    }

    // ── Local data ─────────────────────────────────────────────────────────
    if (local) {
      // Gather tool names from all runs
      const localToolNames = local.runs
        ? [...new Set(local.runs.flatMap((r) => r.tool_names_called))]
        : local.assertions
            .filter((a) => a.type === "tools_include")
            .flatMap((a) => [a.message])  // best effort from assertion messages
            .filter(Boolean);
      const localCompletionRate = local.runs
        ? local.runs.filter((r) => r.completed).length / local.runs.length
        : 1;
      const localRounds = local.runs?.map((r) => r.rounds) ?? [local.metrics.tools_count.length];
      const avgLocal = localRounds.reduce((s, v) => s + v, 0) / localRounds.length;

      sa.local = {
        avg_rounds: local.avg_rounds ?? avgLocal,
        min_rounds: local.min_rounds ?? Math.min(...localRounds),
        max_rounds: local.max_rounds ?? Math.max(...localRounds),
        rounds_variance: local.rounds_variance ?? 0,
        completion_rate: localCompletionRate,
        tool_names_observed: localToolNames,
        avg_ttfb_ms: local.timing?.avg_ttfb_ms,
      };
    }

    // ── Live data ──────────────────────────────────────────────────────────
    if (live) {
      const liveToolNames = live.runs
        ? [...new Set(live.runs.flatMap((r) => r.tool_names_called))]
        : [];
      const liveCompletionRate = live.runs
        ? live.runs.filter((r) => r.completed).length / live.runs.length
        : 1;
      const liveRounds = live.runs?.map((r) => r.rounds) ?? [live.metrics.tools_count.length];
      const avgLive = liveRounds.reduce((s, v) => s + v, 0) / liveRounds.length;

      sa.live = {
        avg_rounds: live.avg_rounds ?? avgLive,
        min_rounds: live.min_rounds ?? Math.min(...liveRounds),
        max_rounds: live.max_rounds ?? Math.max(...liveRounds),
        rounds_variance: live.rounds_variance ?? 0,
        completion_rate: liveCompletionRate,
        total_cost: live.total_cost,
        tool_names_observed: liveToolNames,
        avg_ttfb_ms: live.timing?.avg_ttfb_ms,
      };
    }

    // ── Cross-mode tool agreement ──────────────────────────────────────────
    if (sa.local && sa.live) {
      const jaccard = jaccardSimilarity(sa.local.tool_names_observed, sa.live.tool_names_observed);
      sa.tool_jaccard = Math.round(jaccard * 100) / 100;
      sa.tool_sequence_agreement = jaccard >= 0.75;
    }

    scenarioAnalyses.push(sa);
  }

  // ── Cross-mode summary ─────────────────────────────────────────────────────
  const summary: CrossModeComparison = {};

  // Token cost ratio: live total vs mock total
  if (mockReport && liveReport && mockReport.total_cost > 0) {
    summary.live_vs_mock_cost_ratio =
      Math.round((liveReport.total_cost / mockReport.total_cost) * 100) / 100;
  }

  // Average round count delta (local vs live)
  const roundDeltas = scenarioAnalyses
    .filter((s) => s.local && s.live)
    .map((s) => Math.abs((s.local!.avg_rounds) - (s.live!.avg_rounds)));
  if (roundDeltas.length > 0) {
    summary.avg_round_count_delta =
      Math.round((roundDeltas.reduce((s, v) => s + v, 0) / roundDeltas.length) * 100) / 100;
  }

  // Tool agreement percentage
  const agreementScenarios = scenarioAnalyses.filter((s) => s.tool_sequence_agreement !== undefined);
  if (agreementScenarios.length > 0) {
    const agreeing = agreementScenarios.filter((s) => s.tool_sequence_agreement).length;
    summary.tool_agreement_pct = Math.round((agreeing / agreementScenarios.length) * 100);
  }

  // Avg TTFB
  const localTtfbs = scenarioAnalyses.map((s) => s.local?.avg_ttfb_ms ?? 0).filter((v) => v > 0);
  if (localTtfbs.length > 0) {
    summary.avg_local_ttfb_ms = Math.round(localTtfbs.reduce((s, v) => s + v, 0) / localTtfbs.length);
  }
  const liveTtfbs = scenarioAnalyses.map((s) => s.live?.avg_ttfb_ms ?? 0).filter((v) => v > 0);
  if (liveTtfbs.length > 0) {
    summary.avg_live_ttfb_ms = Math.round(liveTtfbs.reduce((s, v) => s + v, 0) / liveTtfbs.length);
  }

  // Completion rates
  const localScenarios = scenarioAnalyses.filter((s) => s.local);
  if (localScenarios.length > 0) {
    summary.local_completion_rate =
      Math.round((localScenarios.reduce((s, sc) => s + sc.local!.completion_rate, 0) / localScenarios.length) * 100) / 100;
  }
  const liveScenarios = scenarioAnalyses.filter((s) => s.live);
  if (liveScenarios.length > 0) {
    summary.live_completion_rate =
      Math.round((liveScenarios.reduce((s, sc) => s + sc.live!.completion_rate, 0) / liveScenarios.length) * 100) / 100;
  }

  const analysis: Analysis = {
    generated_at: new Date().toISOString(),
    run_dir: runDir,
    modes_collected: modesCollected,
    scenarios: scenarioAnalyses,
    summary,
  };

  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, "analysis.json"), JSON.stringify(analysis, null, 2));
  return analysis;
}
