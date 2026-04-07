/**
 * refinement/assertions.ts
 *
 * Evaluates assertions against collected inspection records.
 * Each assertion returns { pass, message }.
 */

import type { AssertionDef, AssertionResult, InspectionRecord } from "./types.ts";

export function evaluateAssertion(
  assertion: AssertionDef,
  records: InspectionRecord[],
): AssertionResult {
  const type = assertion.type;

  // cache_prefix_stable — all requests with tools share the same tools_hash as the first
  if (type === "cache_prefix_stable") {
    const toolRecords = records.filter((r) => r.tools_count > 0);
    if (toolRecords.length === 0) {
      return { type, pass: true, message: "No requests recorded." };
    }
    const first = toolRecords[0].tools_hash;
    const mismatches = toolRecords.filter((r) => r.tools_hash !== first);
    if (mismatches.length === 0) {
      return { type, pass: true, message: `All ${toolRecords.length} requests share tools_hash ${first}` };
    }
    const detail = mismatches.map((r) => `req_${r.request_id}: ${r.tools_hash}`).join(", ");
    return {
      type,
      pass: false,
      message: `Cache prefix broken — first hash: ${first}, mismatches: ${detail}`,
    };
  }

  // tools_hash_stable — stricter version: all requests with tools must share the same tools_hash
  if (type === "tools_hash_stable") {
    const toolRecords = records.filter((r) => r.tools_count > 0);
    if (toolRecords.length === 0) {
      return { type, pass: true, message: "No requests recorded." };
    }
    const hashes = new Set(toolRecords.map((r) => r.tools_hash));
    if (hashes.size === 1) {
      return { type, pass: true, message: `All ${toolRecords.length} requests share tools_hash ${[...hashes][0]}` };
    }
    return {
      type,
      pass: false,
      message: `tools_hash_stable: ${hashes.size} distinct hashes found: ${[...hashes].join(", ")}`,
    };
  }

  // tools_include — specified tools must appear in the schema of ALL requests
  if (type === "tools_include") {
    if (records.length === 0) return { type, pass: false, message: "No requests recorded." };
    const names = assertion.names ?? [];
    const firstRecord = records[0];
    const missing = names.filter((n) => !firstRecord.tools_names.includes(n));
    if (missing.length === 0) {
      return { type, pass: true, message: `All required tools present in schema: ${names.join(",")}` };
    }
    return { type, pass: false, message: `tools_include: missing from schema: ${missing.join(",")}` };
  }

  // tools_exclude — specified tools must be absent from the schema
  if (type === "tools_exclude") {
    if (records.length === 0) return { type, pass: true, message: "No requests recorded." };
    const names = assertion.names ?? [];
    const firstRecord = records[0];
    const found = names.filter((n) => firstRecord.tools_names.includes(n));
    if (found.length === 0) {
      return { type, pass: true, message: `None of excluded tools present in schema: ${names.join(",")}` };
    }
    return { type, pass: false, message: `tools_exclude: found in schema: ${found.join(",")}` };
  }

  // max_tokens_initial — first request max_tokens matches expected
  if (type === "max_tokens_initial") {
    if (records.length === 0) return { type, pass: false, message: "No requests recorded." };
    const first = records[0];
    const expected = assertion.value;
    if (first.max_tokens === expected) {
      return { type, pass: true, message: `max_tokens=${first.max_tokens} matches expected ${expected}` };
    }
    return {
      type,
      pass: false,
      message: `max_tokens_initial: expected ${expected}, got ${first.max_tokens}`,
    };
  }

  // tool_result_max_chars — evaluated by runner (needs raw tool results)
  if (type === "tool_result_max_chars") {
    return { type, pass: true, message: `tool_result_max_chars — evaluated by runner` };
  }

  // tools_count — total number of tools in the first request
  if (type === "tools_count") {
    if (records.length === 0) return { type, pass: false, message: "No requests recorded." };
    const first = records[0];
    const expected = assertion.value;
    if (first.tools_count === expected) {
      return { type, pass: true, message: `tools_count=${first.tools_count} matches expected ${expected}` };
    }
    return {
      type,
      pass: false,
      message: `tools_count: expected ${expected}, got ${first.tools_count}`,
    };
  }

  // sub_agent_gets_parent_tools — sub-agent requests share the same tools_hash as parent
  if (type === "sub_agent_gets_parent_tools") {
    if (records.length === 0) {
      return { type, pass: true, message: "No requests recorded." };
    }
    const parentRecord = records.find((r) => r.label === "parent");
    if (!parentRecord) {
      return { type, pass: true, message: "No parent request found — skipping." };
    }
    const subAgentRecords = records.filter((r) => r.label !== "parent");
    if (subAgentRecords.length === 0) {
      return { type, pass: true, message: "No sub-agent requests recorded." };
    }
    const mismatches = subAgentRecords.filter((r) => r.tools_hash !== parentRecord.tools_hash);
    if (mismatches.length === 0) {
      return {
        type,
        pass: true,
        message: `All ${subAgentRecords.length} sub-agent request(s) share parent tools_hash ${parentRecord.tools_hash}`,
      };
    }
    const detail = mismatches.map((r) => `req_${r.request_id}[${r.label}]: ${r.tools_hash}`).join(", ");
    return {
      type,
      pass: false,
      message: `sub_agent_gets_parent_tools: hash mismatch — parent: ${parentRecord.tools_hash}, diff: ${detail}`,
    };
  }

  // cost_under — total scenario cost must be under the given dollar amount
  if (type === "cost_under") {
    const totalCost = records.reduce((sum, r) => sum + r.cost.total_cost, 0);
    const limit = assertion.value;
    if (totalCost <= limit) {
      return {
        type,
        pass: true,
        message: `Total cost $${totalCost.toFixed(4)} is under limit $${limit.toFixed(4)}`,
      };
    }
    return {
      type,
      pass: false,
      message: `cost_under: $${totalCost.toFixed(4)} exceeds limit $${limit.toFixed(4)}`,
    };
  }

  return { type, pass: false, message: `Unknown assertion type: ${type}` };
}

export function evaluateAssertions(
  assertions: AssertionDef[],
  records: InspectionRecord[],
  /** supplemental raw data from engine execution */
  extras?: {
    toolNames?: string[];
    toolResults?: Array<{ tool: string; result: string }>;
  },
): AssertionResult[] {
  return assertions.map((a) => {
    // tool_result_max_chars still delegates to engine extras when available
    if (a.type === "tool_result_max_chars" && extras?.toolResults) {
      const results = extras.toolResults.filter((r) => r.tool === a.tool);
      const violations = results.filter((r) => r.result.length > a.limit);
      if (violations.length === 0) {
        return { type: a.type, pass: true, message: `All ${a.tool} results within ${a.limit} chars` };
      }
      return {
        type: a.type,
        pass: false,
        message: `tool_result_max_chars: ${a.tool} result exceeded ${a.limit} chars (got ${violations[0].result.length})`,
      };
    }
    return evaluateAssertion(a, records);
  });
}

