import type { EngineEvent, ExecutionEngine, ExecutionParams } from "../../engine/types.ts";

type ScriptStep = EngineEvent | { type: "wait_for_abort" };

/**
 * ScriptedEngine implements ExecutionEngine by yielding pre-scripted EngineEvent sequences.
 * Supports a `wait_for_abort` step to pause the generator until the execution is cancelled,
 * enabling cancel-path tests without involving any real AI provider.
 *
 * Usage:
 *   const engine = new ScriptedEngine();
 *   engine.queueTurn([
 *     { type: "reasoning", content: "thinking..." },
 *     { type: "wait_for_abort" },   // pauses until cancel() is called
 *     { type: "token", content: "Hello." },
 *     { type: "done" },
 *   ]);
 */
export class ScriptedEngine implements ExecutionEngine {
    private readonly turns: ScriptStep[][] = [];

    queueTurn(steps: ScriptStep[]): this {
        this.turns.push(steps);
        return this;
    }

    execute(params: ExecutionParams): AsyncIterable<EngineEvent> {
        const steps = this.turns.shift();
        if (!steps) throw new Error("ScriptedEngine: no turn queued");
        return this.emit(steps, params.signal);
    }

    // Abort signal in params already cancels the generator (wait_for_abort step).
    cancel(_executionId: number): void { /* no-op */ }

    async resume(_executionId: number, _input: import("../../engine/types.ts").EngineResumeInput): Promise<void> { /* no-op */ }

    async listModels(): Promise<import("../../engine/types.ts").EngineModelInfo[]> { return []; }

    private async *emit(steps: ScriptStep[], signal: AbortSignal): AsyncGenerator<EngineEvent> {
        for (const step of steps) {
            if (step.type === "wait_for_abort") {
                if (!signal.aborted) {
                    await new Promise<void>((resolve) => {
                        signal.addEventListener("abort", () => resolve(), { once: true });
                    });
                }
                continue;
            }
            yield step as EngineEvent;
        }
    }
}

// ─── Helpers to build script steps ──────────────────────────────────────────

export function scriptToken(content: string): EngineEvent {
    return { type: "token", content };
}

export function scriptReasoning(content: string): EngineEvent {
    return { type: "reasoning", content };
}

export function scriptStatus(message: string): EngineEvent {
    return { type: "status", message };
}

export function scriptToolStart(callId: string, name: string, args: Record<string, unknown> = {}): EngineEvent {
    return { type: "tool_start", callId, name, arguments: JSON.stringify(args) };
}

export function scriptToolResult(callId: string, name: string, result: string, isError = false): EngineEvent {
    return { type: "tool_result", callId, name, result, isError };
}

export function scriptDone(): EngineEvent {
    return { type: "done" };
}

export function scriptWaitForAbort(): ScriptStep {
    return { type: "wait_for_abort" };
}

