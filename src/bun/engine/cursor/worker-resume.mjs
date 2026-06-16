// Resume-or-create helper for the Cursor worker.
//
// Extracted into a sibling ESM module so it can be unit-tested in isolation
// from the @cursor/sdk subprocess. The worker imports this and passes its
// own `Agent` namespace from the SDK; tests pass a stub `Agent`.
//
// Contract:
//   - With no agentId, fall through to Agent.create(baseOptions) unchanged
//     (preserves the SDK's auto-id behaviour for callers that don't pin one).
//   - With an agentId, try Agent.resume(agentId, baseOptions) first. On
//     failure (typically the first turn for a conversation, or a corrupted
//     local store), fall through to Agent.create({ ...baseOptions, agentId })
//     with the same id so subsequent turns can resume it.

export async function resumeOrCreateAgent(Agent, agentId, baseOptions) {
  if (!agentId) {
    return Agent.create(baseOptions);
  }
  try {
    return await Agent.resume(agentId, baseOptions);
  } catch {
    return Agent.create({ ...baseOptions, agentId });
  }
}
