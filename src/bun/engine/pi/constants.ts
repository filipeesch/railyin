/**
 * SDK built-in tool names that are always available on every Pi agent session,
 * both parent sessions and child delegate sessions.
 *
 * The Pi SDK's `tools` parameter on createAgentSession() acts as a GLOBAL
 * allowlist that filters BOTH built-in and custom tools. If a built-in name
 * is omitted the SDK silently drops any model call to that tool, causing
 * the model to loop or stall.
 */
export const SDK_BUILTIN_TOOL_NAMES = ["read", "grep", "find", "ls"] as const;

export type SdkBuiltinToolName = (typeof SDK_BUILTIN_TOOL_NAMES)[number];

/**
 * Build the full SDK `tools` allowlist for a Pi agent session.
 *
 * The allowlist is the union of the SDK built-in names and the names of every
 * custom tool in the provided list. Using this helper at every construction
 * site ensures they cannot diverge and that newly added tools are included
 * automatically without requiring a manual allowlist update.
 *
 * Accepts any array whose elements expose a `name` string — works with
 * `AgentTool`, `ToolDefinition`, and test doubles alike.
 */
export function buildToolAllowlist(tools: ReadonlyArray<{ name: string }>): string[] {
  return [...SDK_BUILTIN_TOOL_NAMES, ...tools.map((t) => t.name)];
}
