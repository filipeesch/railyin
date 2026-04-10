import type {
    CopilotSdkAdapter,
    CopilotSdkEvent,
    CopilotSdkModelInfo,
    CopilotSdkResumeSessionConfig,
    CopilotSdkSession,
    CopilotSdkSessionConfig,
} from "../../engine/copilot/session.ts";

type MockTurnStep =
    | { kind: "emit"; event: CopilotSdkEvent }
    | { kind: "waitForAbort" };

export interface MockTurnScript {
    sendError?: Error;
    steps: MockTurnStep[];
}

type ResumeOutcome = { kind: "success"; session: MockCopilotSession } | { kind: "error"; error: Error };
type CreateOutcome = { kind: "success"; session: MockCopilotSession } | { kind: "error"; error: Error };

export class MockCopilotSession implements CopilotSdkSession {
    private readonly listeners = new Set<(event: CopilotSdkEvent) => void>();
    private readonly turns: MockTurnScript[] = [];
    private abortWaiters: Array<() => void> = [];
    private aborted = false;
    readonly prompts: string[] = [];
    disconnectCalls = 0;
    abortCalls = 0;

    queueTurn(script: MockTurnScript): this {
        this.turns.push(script);
        return this;
    }

    send(input: { prompt: string }): Promise<unknown> {
        this.prompts.push(input.prompt);
        const script = this.turns.shift();
        if (!script) {
            return Promise.reject(new Error("No mock turn script queued"));
        }
        if (script.sendError) {
            return Promise.reject(script.sendError);
        }

        queueMicrotask(async () => {
            for (const step of script.steps) {
                if (this.aborted) return;
                if (step.kind === "emit") {
                    this.emit(step.event);
                    continue;
                }
                await new Promise<void>((resolve) => {
                    if (this.aborted) {
                        resolve();
                        return;
                    }
                    this.abortWaiters.push(resolve);
                });
            }
        });

        return Promise.resolve(undefined);
    }

    on(listener: (event: CopilotSdkEvent) => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    async abort(): Promise<void> {
        this.abortCalls += 1;
        this.aborted = true;
        for (const resolve of this.abortWaiters) resolve();
        this.abortWaiters = [];
    }

    async disconnect(): Promise<void> {
        this.disconnectCalls += 1;
    }

    private emit(event: CopilotSdkEvent): void {
        for (const listener of this.listeners) {
            listener(event);
        }
    }
}

export class MockCopilotSdkAdapter implements CopilotSdkAdapter {
    private readonly resumeOutcomes: ResumeOutcome[] = [];
    private readonly createOutcomes: CreateOutcome[] = [];
    private models: CopilotSdkModelInfo[] = [];

    readonly trace = {
        resumeCalls: [] as Array<{ sessionId: string; config: CopilotSdkResumeSessionConfig }>,
        createCalls: [] as Array<{ sessionId: string; config: CopilotSdkSessionConfig & { sessionId: string } }>,
        abortCalls: 0,
        disconnectCalls: 0,
        listModelsCalls: 0,
    };

    queueResumeSuccess(session: MockCopilotSession): this {
        this.resumeOutcomes.push({ kind: "success", session });
        return this;
    }

    queueResumeFailure(error: Error): this {
        this.resumeOutcomes.push({ kind: "error", error });
        return this;
    }

    queueCreateSuccess(session: MockCopilotSession): this {
        this.createOutcomes.push({ kind: "success", session });
        return this;
    }

    queueCreateFailure(error: Error): this {
        this.createOutcomes.push({ kind: "error", error });
        return this;
    }

    setModels(models: CopilotSdkModelInfo[]): this {
        this.models = models;
        return this;
    }

    async createSession(config: CopilotSdkSessionConfig & { sessionId: string }): Promise<CopilotSdkSession> {
        this.trace.createCalls.push({ sessionId: config.sessionId, config });
        const outcome = this.createOutcomes.shift();
        if (!outcome) throw new Error("No mock createSession outcome queued");
        if (outcome.kind === "error") throw outcome.error;
        return outcome.session;
    }

    async resumeSession(sessionId: string, config: CopilotSdkResumeSessionConfig): Promise<CopilotSdkSession> {
        this.trace.resumeCalls.push({ sessionId, config });
        const outcome = this.resumeOutcomes.shift();
        if (!outcome) throw new Error("No mock resumeSession outcome queued");
        if (outcome.kind === "error") throw outcome.error;
        return outcome.session;
    }

    async abortSession(session: CopilotSdkSession): Promise<void> {
        this.trace.abortCalls += 1;
        await session.abort();
    }

    async disconnectSession(session: CopilotSdkSession): Promise<void> {
        this.trace.disconnectCalls += 1;
        await session.disconnect();
    }

    async listModels(): Promise<CopilotSdkModelInfo[]> {
        this.trace.listModelsCalls += 1;
        return this.models;
    }

    async pingClient(_sessionId: string): Promise<boolean> {
        return true;
    }

    async releaseClient(_sessionId: string): Promise<void> {
        // no-op in mock — no real CLI to release
    }

    onStatus(_listener: (message: string) => void): () => void {
        // no-op in mock — no setup progress to report
        return () => {};
    }
}

export function token(content: string): MockTurnStep {
    return { kind: "emit", event: { type: "assistant.message_delta", data: { deltaContent: content } } };
}

export function reasoning(content: string): MockTurnStep {
    return { kind: "emit", event: { type: "assistant.reasoning_delta", data: { deltaContent: content } } };
}

export function toolStart(callId: string, toolName: string, args: unknown = {}): MockTurnStep {
    return toolStartWithOptions(callId, toolName, args);
}

export function toolStartWithOptions(
    callId: string,
    toolName: string,
    args: unknown = {},
    options: { parentToolCallId?: string; source?: string } = {},
): MockTurnStep {
    return {
        kind: "emit",
        event: {
            type: "tool.execution_start",
            ...(options.source ? { source: options.source } : {}),
            data: { toolCallId: callId, toolName, arguments: args, parentToolCallId: options.parentToolCallId },
        },
    };
}

export function toolResult(callId: string, result: string, success = true): MockTurnStep {
    return toolResultWithOptions(callId, result, success);
}

export function toolResultWithOptions(
    callId: string,
    result: string,
    success = true,
    options: { detailedContent?: string; contents?: Array<Record<string, unknown>>; source?: string } = {},
): MockTurnStep {
    return {
        kind: "emit",
        event: {
            type: "tool.execution_complete",
            ...(options.source ? { source: options.source } : {}),
            data: {
                toolCallId: callId,
                success,
                result: {
                    content: result,
                    detailedContent: options.detailedContent,
                    contents: options.contents,
                },
            },
        },
    };
}

export function usage(inputTokens: number, outputTokens: number): MockTurnStep {
    return { kind: "emit", event: { type: "assistant.usage", data: { inputTokens, outputTokens } } };
}

export function done(): MockTurnStep {
    return { kind: "emit", event: { type: "session.task_complete" } };
}

export function askUser(payload = '{"question":"Need input"}'): MockTurnStep {
    return { kind: "emit", event: { type: "session.ask_user", data: { payload } } };
}

export function fatalSessionError(message: string): MockTurnStep {
    return { kind: "emit", event: { type: "session.error", data: { message } } };
}

export function waitForAbort(): MockTurnStep {
    return { kind: "waitForAbort" };
}
