import type { EngineEvent, ExecutionEngine, ExecutionParams } from "../../engine/types.ts";

type ScriptStep =
    | EngineEvent
    | { type: "wait_for_abort" }
    | { type: "checkpoint"; name: string };

/**
 * ScriptedEngine implements ExecutionEngine with fully scripted turns.
 *
 * Supports two flow-control steps:
 *   scriptWaitForAbort()     — pauses until the execution's AbortSignal fires
 *   scriptCheckpoint(name)   — pauses until the test calls engine.proceed(name)
 *
 * Checkpoint protocol lets a test freeze the producer mid-stream and assert
 * on the two IPC/DB channels independently:
 *
 *   engine.queueTurn([
 *     scriptReasoning("thinking"),
 *     scriptCheckpoint("after-reasoning"),   // engine pauses here
 *     scriptToolStart("c1", "read_file"),
 *     scriptCheckpoint("after-tool"),
 *     scriptDone(),
 *   ]);
 *
 *   // In test body:
 *   await engine.waitForCheckpoint("after-reasoning");
 *   // → assert IPC has reasoning_chunk, DB has nothing yet
 *   engine.proceed("after-reasoning");
 *
 *   await engine.waitForCheckpoint("after-tool");
 *   // → assert IPC has tool_start, DB has reasoning (immediate flush)
 *   engine.proceed("after-tool");
 */
export class ScriptedEngine implements ExecutionEngine {
    private readonly turns: ScriptStep[][] = [];
    private readonly checkpoints = new Map<string, {
        reached: Promise<void>;
        resolveReached: () => void;
        proceed: Promise<void>;
        resolveProceed: () => void;
    }>();

    queueTurn(steps: ScriptStep[]): this {
        this.turns.push(steps);
        // Pre-register checkpoints from the turn so waitForCheckpoint() works before execute()
        for (const step of steps) {
            if (step.type === "checkpoint") {
                this._registerCheckpoint(step.name);
            }
        }
        return this;
    }

    private _registerCheckpoint(name: string): void {
        if (this.checkpoints.has(name)) return;
        let resolveReached!: () => void;
        let resolveProceed!: () => void;
        const reached = new Promise<void>((r) => { resolveReached = r; });
        const proceed = new Promise<void>((r) => { resolveProceed = r; });
        this.checkpoints.set(name, { reached, resolveReached, proceed, resolveProceed });
    }

    /** Wait until the engine has paused at this checkpoint. */
    async waitForCheckpoint(name: string, timeoutMs = 5_000): Promise<void> {
        const cp = this.checkpoints.get(name);
        if (!cp) throw new Error(`ScriptedEngine: checkpoint "${name}" not registered`);
        await Promise.race([
            cp.reached,
            new Promise<void>((_, reject) =>
                setTimeout(() => reject(new Error(`Timed out waiting for checkpoint "${name}"`)), timeoutMs),
            ),
        ]);
    }

    /** Allow the engine to continue past a checkpoint. */
    proceed(name: string): void {
        const cp = this.checkpoints.get(name);
        if (!cp) throw new Error(`ScriptedEngine: checkpoint "${name}" not registered`);
        cp.resolveProceed();
    }

    execute(params: ExecutionParams): AsyncIterable<EngineEvent> {
        const steps = this.turns.shift();
        if (!steps) throw new Error("ScriptedEngine: no turn queued");
        return this.emit(steps, params.signal);
    }

    cancel(_executionId: number): void { /* AbortSignal handles this */ }

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

            if (step.type === "checkpoint") {
                const cp = this.checkpoints.get(step.name)!;
                cp.resolveReached();
                await cp.proceed;
                continue;
            }

            yield step as EngineEvent;
        }
    }
}

// ─── Script step builders ────────────────────────────────────────────────────

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

export function scriptCheckpoint(name: string): ScriptStep {
    return { type: "checkpoint", name };
}


