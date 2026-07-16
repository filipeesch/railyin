/**
 * Resume-or-create helper for the in-process Cursor adapter.
 *
 * Kept in its own module so it can be unit-tested in isolation with a stub
 * `Agent` — the real adapter passes the real `@cursor/sdk` `Agent` namespace,
 * tests pass a fake with the same shape.
 *
 * Contract:
 *   - With no agentId, fall through to Agent.create(baseOptions) unchanged
 *     (preserves the SDK's auto-id behaviour for callers that don't pin one).
 *   - With an agentId, try Agent.resume(agentId, baseOptions) first. On
 *     failure (typically the first turn for a conversation, or a corrupted
 *     local store), fall through to Agent.create({ ...baseOptions, agentId })
 *     with the same id so subsequent turns can resume it.
 */

import type { AgentOptions, SDKAgent } from "@cursor/sdk";

/**
 * Generic over the created/resumed agent type so tests can pass a minimal
 * stub instead of a full `SDKAgent`. Production code always resolves
 * `TAgent = SDKAgent` from the real `@cursor/sdk` `Agent` export.
 */
export interface AgentNamespace<TAgent = SDKAgent> {
  create(options: AgentOptions): Promise<TAgent>;
  resume(agentId: string, options?: Partial<AgentOptions>): Promise<TAgent>;
}

export async function resumeOrCreateAgent<TAgent = SDKAgent>(
  Agent: AgentNamespace<TAgent>,
  agentId: string | undefined,
  baseOptions: AgentOptions,
): Promise<TAgent> {
  if (!agentId) {
    return Agent.create(baseOptions);
  }
  try {
    return await Agent.resume(agentId, baseOptions);
  } catch {
    return Agent.create({ ...baseOptions, agentId });
  }
}
