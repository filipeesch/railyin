import type { ConversationMessage, StreamEvent, Task } from "../../../shared/rpc-types.ts";

export interface RecordedTokenEvent {
    taskId: number | null;
    conversationId: number;
    executionId: number;
    token: string;
    done: boolean;
    isReasoning?: boolean;
    isStatus?: boolean;
}

export interface RecordedErrorEvent {
    taskId: number | null;
    conversationId: number;
    executionId: number;
    error: string;
}

async function waitUntil(predicate: () => boolean, description: string, timeoutMs = 5_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (predicate()) return;
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`Timed out waiting for ${description}`);
}

export class CallbackRecorder {
    readonly tokenEvents: RecordedTokenEvent[] = [];
    readonly taskUpdates: Task[] = [];
    readonly newMessages: ConversationMessage[] = [];
    readonly errors: RecordedErrorEvent[] = [];
    readonly streamEvents: StreamEvent[] = [];

    recordToken = (
        taskId: number | null,
        conversationId: number,
        executionId: number,
        token: string,
        done: boolean,
        isReasoning?: boolean,
        isStatus?: boolean,
    ): void => {
        this.tokenEvents.push({ taskId, conversationId, executionId, token, done, isReasoning, isStatus });
    };

    recordTaskUpdate = (task: Task): void => {
        this.taskUpdates.push(task);
    };

    recordNewMessage = (message: ConversationMessage): void => {
        this.newMessages.push(message);
    };

    recordError = (taskId: number | null, conversationId: number, executionId: number, error: string): void => {
        this.errors.push({ taskId, conversationId, executionId, error });
    };

    recordStreamEvent = (event: StreamEvent): void => {
        this.streamEvents.push(event);
    };

    async waitForStreamDone(executionId: number, timeoutMs = 5_000): Promise<void> {
        await waitUntil(
            () => this.streamEvents.some((e) => e.executionId === executionId && e.type === "done"),
            `stream done for execution ${executionId}`,
            timeoutMs,
        );
    }

    streamEventsForExecution(executionId: number): StreamEvent[] {
        return this.streamEvents.filter((e) => e.executionId === executionId);
    }

    async waitForTokenDone(executionId: number, timeoutMs = 5_000): Promise<void> {
        await waitUntil(
            () => this.tokenEvents.some((event) => event.executionId === executionId && event.done),
            `token completion for execution ${executionId}`,
            timeoutMs,
        );
    }

    async waitForAnyToken(executionId: number, timeoutMs = 5_000): Promise<void> {
        await waitUntil(
            () => this.tokenEvents.some((event) => event.executionId === executionId && !event.done),
            `first token for execution ${executionId}`,
            timeoutMs,
        );
    }

    async waitForAnyStreamContent(executionId: number, timeoutMs = 5_000): Promise<void> {
        await waitUntil(
            () => this.streamEvents.some((e) => e.executionId === executionId && e.type === "text_chunk"),
            `first text_chunk stream event for execution ${executionId}`,
            timeoutMs,
        );
    }

    async waitForTaskState(taskId: number, state: string, timeoutMs = 5_000): Promise<Task> {
        await waitUntil(
            () => this.taskUpdates.some((task) => task.id === taskId && task.executionState === state),
            `task ${taskId} entering state ${state}`,
            timeoutMs,
        );
        return this.taskUpdates.filter((task) => task.id === taskId && task.executionState === state).at(-1)!;
    }

    async waitForMessage(taskId: number, type: ConversationMessage["type"], timeoutMs = 5_000): Promise<ConversationMessage> {
        await waitUntil(
            () => this.newMessages.some((message) => message.taskId === taskId && message.type === type),
            `message ${type} for task ${taskId}`,
            timeoutMs,
        );
        return this.newMessages.filter((message) => message.taskId === taskId && message.type === type).at(-1)!;
    }

    async waitForError(executionId: number, timeoutMs = 5_000): Promise<RecordedErrorEvent> {
        await waitUntil(
            () => this.errors.some((error) => error.executionId === executionId),
            `error for execution ${executionId}`,
            timeoutMs,
        );
        return this.errors.filter((error) => error.executionId === executionId).at(-1)!;
    }

    async waitForStableTokenCount(executionId: number, stableMs = 75, timeoutMs = 2_000): Promise<number> {
        const deadline = Date.now() + timeoutMs;
        let lastCount = this.tokenEvents.filter((event) => event.executionId === executionId).length;
        let stableSince = Date.now();

        while (Date.now() < deadline) {
            const currentCount = this.tokenEvents.filter((event) => event.executionId === executionId).length;
            if (currentCount !== lastCount) {
                lastCount = currentCount;
                stableSince = Date.now();
            }
            if (Date.now() - stableSince >= stableMs) return currentCount;
            await new Promise((resolve) => setTimeout(resolve, 10));
        }

        throw new Error(`Timed out waiting for token count to stabilize for execution ${executionId}`);
    }
}
