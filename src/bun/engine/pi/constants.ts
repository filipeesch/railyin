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
