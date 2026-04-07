// Shared types for the refinement harness

export type ProxyMode = "mock" | "local" | "live";

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
  | { type: "cost_under"; value: number };

export interface Scenario {
  name: string;
  description: string;
  modes?: ProxyMode[];
  /** Column tool group names or individual tool names to configure for this scenario. */
  column_tools?: string[];
  script?: ScriptEntry[];
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
}
