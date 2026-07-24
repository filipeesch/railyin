// ─── In-flight OAuth flow bookkeeping ───────────────────────────────────────────
//
// Holds PKCE verifiers and CSRF `state` values for authorization flows that
// have been started (browser opened) but not yet completed (callback
// received). Deliberately a small, focused collaborator — kept out of
// `McpClientRegistry` so the registry doesn't accumulate transient OAuth
// bookkeeping responsibilities.

import type { PendingAuthFlow } from "./types.ts";

const DEFAULT_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes

export class PendingAuthFlowStore {
  private readonly flows = new Map<string, PendingAuthFlow>();
  private readonly expiryMs: number;

  constructor(expiryMs: number = DEFAULT_EXPIRY_MS) {
    this.expiryMs = expiryMs;
  }

  /**
   * Registers a new pending flow for `state`. Any previously pending flow for
   * the same server is invalidated, so a stale authorization code from an
   * abandoned attempt can no longer complete.
   */
  create(state: string, flow: PendingAuthFlow): void {
    for (const [existingState, existingFlow] of this.flows) {
      if (existingFlow.serverName === flow.serverName) {
        this.flows.delete(existingState);
      }
    }
    this.flows.set(state, flow);
  }

  /**
   * Consumes (removes) the pending flow for `state`, if present and not
   * expired. Returns `undefined` for an unknown, already-consumed, or
   * expired state.
   */
  consume(state: string): PendingAuthFlow | undefined {
    const flow = this.flows.get(state);
    if (!flow) return undefined;
    this.flows.delete(state);
    if (Date.now() - flow.createdAt > this.expiryMs) return undefined;
    return flow;
  }

  /** Removes any pending flow for the given server without completing it. */
  invalidateForServer(serverName: string): void {
    for (const [state, flow] of this.flows) {
      if (flow.serverName === serverName) this.flows.delete(state);
    }
  }
}
