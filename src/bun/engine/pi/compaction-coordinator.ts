/**
 * PiCompactionCoordinator — owns background compaction decisions and lifecycle.
 *
 * Receives a MessageAppender interface so it can persist compaction summaries without
 * a direct dependency on the global getDb() singleton (supporting isolated unit tests).
 *
 * Threshold math: soft threshold = contextWindow − (16384 + earlyMargin).
 * When context usage exceeds this threshold after a turn_end event, the coordinator
 * attempts a non-blocking slot acquire and fires session.compact() in the background.
 * The executor loop awaits the promise to decide whether to continue the agent.
 */

import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { PiEngineConfig } from "../../config/index.ts";
import type { ProviderLimiterRegistry } from "./provider-limiter.ts";
import { getDb } from "../../db/index.ts";
import { appendMessage } from "../../conversation/messages.ts";

/** Narrow interface so the coordinator does not import getDb() directly. */
export interface MessageAppender {
  appendCompactionSummary(conversationId: number, summary: string): void;
}

/** Production implementation wrapping the real appendMessage helper. */
export class DefaultMessageAppender implements MessageAppender {
  appendCompactionSummary(conversationId: number, summary: string): void {
    appendMessage(getDb(), null, conversationId, "compaction_summary", null, summary);
  }
}

export class PiCompactionCoordinator {
  /** Map<conversationId, Promise<void>> — tracks in-flight background compactions. */
  readonly bgCompactions = new Map<number, Promise<void>>();

  constructor(
    private readonly config: PiEngineConfig,
    private readonly registry: ProviderLimiterRegistry,
    private readonly appender: MessageAppender,
  ) {}

  /**
   * Called from the session.subscribe() turn_end handler.
   * Fires a background compact() if usage exceeds the soft threshold and
   * no compaction is already running for this conversation.
   */
  handleTurnEnd(
    session: AgentSession,
    conversationId: number,
    providerName: string,
    contextTokens: number | undefined,
    contextWindow: number,
  ): void {
    if (this.config.harness?.background_compaction?.enabled === false) return;
    if (contextTokens == null) return;

    const earlyMargin = this.config.harness?.background_compaction?.early_margin_tokens ?? 8192;
    const softThreshold = contextWindow - (16384 + earlyMargin);

    if (contextTokens <= softThreshold) return;
    if (this.bgCompactions.has(conversationId)) return;

    const release = this.registry.tryAcquire(providerName);
    if (release === null) return;

    const p = this.runCompaction(session, conversationId, release);
    this.bgCompactions.set(conversationId, p);
  }

  private async runCompaction(
    session: AgentSession,
    conversationId: number,
    release: () => void,
  ): Promise<void> {
    try {
      const result = await session.compact();
      if (result?.summary) {
        this.appender.appendCompactionSummary(conversationId, result.summary);
      }
    } catch (err) {
      console.error("[pi] background compaction failed:", err);
    } finally {
      release();
      this.bgCompactions.delete(conversationId);
    }
  }

  /** Returns the pending compaction promise for a conversation, if any. */
  getPending(conversationId: number): Promise<void> | undefined {
    return this.bgCompactions.get(conversationId);
  }

  async waitForAll(): Promise<void> {
    for (const p of this.bgCompactions.values()) {
      await p.catch(() => {});
    }
    this.bgCompactions.clear();
  }
}
