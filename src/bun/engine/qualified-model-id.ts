/**
 * Value object representing a fully-qualified model ID.
 *
 * Format: `{engineId}/{providerId?}/{modelId}`
 *
 *   2-part: `copilot/gpt-4.1`                  → engine=copilot,   model=gpt-4.1
 *   2-part: `claude/claude-sonnet-4-5`          → engine=claude,    model=claude-sonnet-4-5
 *   3-part: `opencode/anthropic/claude-sonnet-4-5` → engine=opencode, provider=anthropic, model=claude-sonnet-4-5
 *
 * All callers above the engine tier treat this as opaque; only the engine adapters
 * and `EngineRegistry` inspect `engineId` / `nativeModelId()`.
 */
export class QualifiedModelId {
  readonly engineId: string;
  readonly providerId: string | undefined;
  readonly modelId: string;

  private constructor(engineId: string, providerId: string | undefined, modelId: string) {
    this.engineId = engineId;
    this.providerId = providerId;
    this.modelId = modelId;
  }

  /**
   * Parse a qualified model ID string.
   * Throws if the string has fewer than 2 segments or any segment is empty.
   */
  static parse(raw: string): QualifiedModelId {
    if (!raw || typeof raw !== "string") {
      throw new Error(`QualifiedModelId.parse: expected non-empty string, got ${JSON.stringify(raw)}`);
    }
    const parts = raw.split("/");
    if (parts.length < 2) {
      throw new Error(`QualifiedModelId.parse: "${raw}" must have at least 2 segments (engineId/modelId)`);
    }
    if (parts.some((p) => p.length === 0)) {
      throw new Error(`QualifiedModelId.parse: "${raw}" contains empty segment`);
    }
    if (parts.length === 2) {
      return new QualifiedModelId(parts[0], undefined, parts[1]);
    }
    // 3 or more parts: first = engine, second = provider, rest joined = model
    const engineId = parts[0];
    const providerId = parts[1];
    const modelId = parts.slice(2).join("/");
    return new QualifiedModelId(engineId, providerId, modelId);
  }

  /**
   * Parse without throwing. Returns null when the input is null/undefined/empty
   * or otherwise unparseable.
   */
  static tryParse(raw: string | null | undefined): QualifiedModelId | null {
    if (!raw) return null;
    try {
      return QualifiedModelId.parse(raw);
    } catch {
      return null;
    }
  }

  /**
   * Returns true if the string can be parsed as a QualifiedModelId.
   */
  static isValid(raw: string): boolean {
    try {
      QualifiedModelId.parse(raw);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Returns the model ID in the format the underlying engine expects.
   *
   * - Copilot / Claude (no provider): returns `modelId` alone
   * - OpenCode (has provider): returns `providerId/modelId`
   */
  nativeModelId(): string {
    if (this.providerId !== undefined) {
      return `${this.providerId}/${this.modelId}`;
    }
    return this.modelId;
  }

  toString(): string {
    if (this.providerId !== undefined) {
      return `${this.engineId}/${this.providerId}/${this.modelId}`;
    }
    return `${this.engineId}/${this.modelId}`;
  }
}
