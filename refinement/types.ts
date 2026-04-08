// Shared types for the refinement harness

export type ProxyMode = "mock" | "local" | "live" | "auto";

// ─── Provider types ───────────────────────────────────────────────────────────

export type ProviderType = "mock" | "lmstudio" | "anthropic";

/** Pricing rates per million tokens. */
export interface ProviderPricing {
  input: number;
  cache_write: number;
  cache_read: number;
  output: number;
}

export interface ProviderConfig {
  id: string;
  type: ProviderType;
  /** Model key used with lms load / as model ID string segment. */
  model_key?: string;
  /** Display name / model ID (e.g. "anthropic/claude-sonnet-4-20250514"). */
  model?: string;
  /** Host for lmstudio providers (default: localhost). */
  host?: string;
  /** Port for lmstudio providers (default: 1234). */
  port?: number;
  /** Anthropic API key. Falls back to ANTHROPIC_API_KEY env var. */
  api_key?: string;
  /** Context length supported by the model. */
  context_length?: number;
  /** GPU fraction (e.g. 1.0 = max). Used with lms load --gpu. */
  gpu?: number;
  /** LM Link device name for network LM Studio instances. When set, skip local lms load/unload. */
  link_device?: string;
  /** Optional per-provider pricing (falls back to Sonnet defaults). */
  pricing?: ProviderPricing;
  /** Resolved backend URL (computed by loadProviders). */
  backendUrl?: string;
}

export interface ProvidersYaml {
  /** Git commit to pin for worktree creation. */
  stable_commit: string;
  /** How many runs to execute per scenario per provider (default: 2). */
  runs_per_scenario?: number;
  /** Provider IDs to use when --providers flag is omitted. */
  default_providers?: string[];
  /** Provider to use for behavioral gate validation. If absent, first lmstudio provider is used. */
  behavioral_provider?: string;
  providers: ProviderConfig[];
}

// ─── Response capture ─────────────────────────────────────────────────────────

export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "thinking"; thinking: string };

export interface ResponseCapture {
  stop_reason: string;
  content_blocks: ContentBlock[];
  usage: { output_tokens: number };
  model: string;
}

// ─── Request timing ───────────────────────────────────────────────────────────

export interface RequestTiming {
  request_received_at: number;
  first_byte_at: number;
  last_byte_at: number;
  ttfb_ms: number;
  duration_ms: number;
}

// ─── Expected behavior (local/live scenarios) ─────────────────────────────────

export interface ExpectedBehavior {
  /** Tool names that MUST be called (hard gate). */
  must_call?: string[];
  /** Tool names that MUST NOT be called (hard gate). */
  must_not_call?: string[];
  /** Maximum allowed round trips (hard gate). */
  max_rounds?: number;
  /** Model must reach stop_reason="end_turn" (hard gate). */
  must_complete?: boolean;
  /** Ideal round trip count (soft metric, recorded but not asserted). */
  ideal_rounds?: number;
  /** Ideal tool call sequence (soft metric, recorded but not asserted). */
  ideal_tool_sequence?: string[];
}

// ─── Finding types ────────────────────────────────────────────────────────────

export type FindingCategory = "token_waste" | "cache_break" | "schema_gap" | "behavioral";
export type FindingStatus = "pending" | "applied" | "confirmed" | "rolled_back" | "ineffective";

export interface Finding {
  id: string;
  category: FindingCategory;
  source: { file: string; line?: number; symbol?: string };
  evidence: {
    current_tokens?: number;
    estimated_after?: number;
    savings_per_request?: number;
    doc_reference: string;
    doc_quote: string;
  };
  metric_contract: {
    metric: "total_cost" | "tools_tokens" | "cache_hit_ratio" | "cache_savings_pct";
    before: number;
    expected_after: number;
  };
  change: { type: string; description: string };
  status: FindingStatus;
  behavioral_validated?: boolean;
}

export interface RoundSummary {
  round: number;
  findings_attempted: number;
  findings_confirmed: number;
  total_cost: number;
}

export interface FindingsReport {
  run_id: string;
  timestamp: string;
  mode: "auto";
  rounds: RoundSummary[];
  findings: Finding[];
  summary: {
    confirmed: number;
    rolled_back: number;
    ineffective: number;
    total_cost_before: number;
    total_cost_after: number;
    improvement_pct: number;
    behavioral_gate?: "passed" | "failed" | "skipped";
  };
}

export interface ScenarioCaptureSummary {
  name: string;
  avg_tools_tokens: number;
  avg_system_tokens: number;
  avg_messages_tokens: number;
  cache_hit_ratio: number;
  total_cost: number;
  capture_paths: string[];
  /** Model used for this scenario run (local/live/mock). */
  model?: string;
  /** Average TTFB in ms (local/live only). */
  avg_ttfb_ms?: number;
  /** Average duration_ms per request (local/live only). */
  avg_duration_ms?: number;
  /** Average number of LLM rounds across runs. */
  avg_rounds?: number;
  /** Completion rate across runs (local/live two-run). */
  completion_rate?: number;
}

export interface CaptureSummary {
  run_id: string;
  timestamp: string;
  total_cost: number;
  cache_hit_ratio: number;
  scenarios: ScenarioCaptureSummary[];
  report_dir: string;
}

/** Per-request token-level cost breakdown (estimated). */
export interface CostEstimate {
  tools_tokens: number;
  system_tokens: number;
  messages_tokens: number;
  output_tokens: number;
  input_cost: number;
  cache_write_cost: number;
  cache_read_cost: number;
  output_cost: number;
  total_cost: number;
}

export interface InspectionRecord {
  request_id: number;
  tools_count: number;
  tools_hash: string;
  system_hash: string;
  cache_control_present: boolean;
  max_tokens: number;
  message_count: number;
  timestamp: string;
  cache_hit: boolean;
  /** Tool names extracted from the request body. */
  tools_names: string[];
  /** Estimated cost for this request. */
  cost: CostEstimate;
  /** Agent label: "parent" or sub-agent label from x-agent-label header. */
  label: string;
  /** Model id from the request body. */
  model: string;
  /** Parsed response (content blocks, stop_reason, real output tokens). Populated after stream ends. */
  response?: ResponseCapture;
  /** Per-request timing. Populated after stream ends. */
  timing?: RequestTiming;
}

export interface ScriptEntry {
  role?: "user";
  content?: string;
  respond_with?: "tool_use" | "text";
  tool?: string;
  input?: Record<string, unknown>;
}

export type AssertionDef =
  | { type: "cache_prefix_stable" }
  | { type: "tools_hash_stable" }
  | { type: "tools_include"; names: string[] }
  | { type: "tools_exclude"; names: string[] }
  | { type: "max_tokens_initial"; value: number }
  | { type: "tool_result_max_chars"; tool: string; limit: number }
  | { type: "tools_count"; value: number }
  | { type: "sub_agent_gets_parent_tools" }
  | { type: "cost_under"; value: number }
  // Behavioral assertions (local/live mode only)
  | { type: "must_call"; tools: string[] }
  | { type: "must_not_call"; tools: string[] }
  | { type: "max_rounds"; value: number }
  | { type: "must_complete" };

export interface Scenario {
  name: string;
  description: string;
  /** @deprecated modes filtering removed — all scenarios run in all modes */
  modes?: ProxyMode[];
  /** Column tool group names or individual tool names to configure for this scenario. */
  column_tools?: string[];
  script?: ScriptEntry[];
  /** Natural language task prompt used by local/live mode (replaces script user entries). */
  prompt?: string;
  /** Behavioral expectations for local/live mode. Mock ignores this. */
  expected_behavior?: ExpectedBehavior;
  /** Fixture directory under refinement/fixtures/ to seed into the temp git repo for local/live. */
  fixtures?: string;
  /** When set to "railyin", uses the provider worktree instead of fixture files. Mutually exclusive with fixtures. */
  codebase?: "railyin";
  assertions: AssertionDef[];
}

export interface AssertionResult {
  type: string;
  pass: boolean;
  message: string;
}

export interface ScenarioReport {
  name: string;
  pass: boolean;
  assertions: AssertionResult[];
  metrics: {
    tools_count: number[];
    tools_hash_values: string[];
    cache_hit_ratio: number;
    max_tokens_values: number[];
  };
  total_cost: number;
  all_cold_cost: number;
  cache_savings: number;
  cache_savings_pct: number;
  /** Model used for this scenario run. */
  model?: string;
  /** Timing aggregates (local/live only). */
  timing?: {
    total_model_time_ms: number;
    avg_ttfb_ms: number;
    scenario_duration_ms: number;
  };
  /** Per-run data for local/live two-run execution. */
  runs?: Array<{
    run: number;
    rounds: number;
    total_cost: number;
    tool_names_called: string[];
    completed: boolean;
  }>;
  avg_rounds?: number;
  rounds_variance?: number;
  /** Standard deviation of per-run costs (variance metric for runs_per_scenario > 1). */
  cost_variance?: number;
  min_rounds?: number;
  max_rounds?: number;
}

export interface RunReport {
  mode: string;
  timestamp: string;
  pass: boolean;
  scenarios: ScenarioReport[];
  metrics: {
    cache_hit_ratio: number;
  };
  total_cost: number;
  all_cold_cost: number;
  cache_savings: number;
  cache_savings_pct: number;
  /** Model used for this run. */
  model?: string;
}
