/**
 * CopilotEngine — implements ExecutionEngine using the GitHub Copilot SDK.
 *
 * Uses @github/copilot-sdk to proxy agent execution through Copilot CLI.
 * Task management tools (tasks_read + tasks_write groups) are registered
 * as custom tools via the SDK's Tool interface from engine/copilot/tools.ts.
 *
 * Auth: handled automatically by the SDK (env vars → CLI login → gh auth).
 * Compaction: handled by Copilot's infinite sessions feature.
 */

import type { ExecutionEngine, ExecutionParams, EngineEvent, EngineModelInfo, EngineResumeInput, CommandInfo, OnTaskUpdated, OnNewMessage } from "../types.ts";
import type { CopilotSdkAdapter, CopilotSdkAttachment, CopilotSdkSession } from "./session";
import { copilotSessionIdForConversation, copilotSessionIdForTask, createDefaultCopilotSdkAdapter } from "./session";
import { translateCopilotStream } from "./events";
import { buildCopilotTools } from "./tools";
import { resolvePrompt } from "../dialects/copilot-prompt-resolver.ts";
import { taskLspRegistry } from "../../lsp/task-registry.ts";
import { getConfig } from "../../config/index.ts";
import { readdirSync, existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, extname, basename, isAbsolute } from "path";
import { homedir, tmpdir } from "os";
import { getMcpRegistry } from "../../mcp/registry.ts";
import { parseFileRef } from "../../utils/resolve-file-attachments.ts";

function utf16LineOffsets(text: string): number[] {
  const offsets = [0];
  let offset = 0;
  for (const char of text) {
    offset += char.length;
    if (char === "\n") offsets.push(offset);
  }
  return offsets;
}

function toSelectionAttachment(filePath: string, displayName: string, text: string): CopilotSdkAttachment {
  const offsets = utf16LineOffsets(text);
  const lastLine = Math.max(0, offsets.length - 1);
  const lastLineStart = offsets[lastLine] ?? 0;
  return {
    type: "selection",
    filePath,
    displayName,
    text,
    selection: {
      start: { line: 0, character: 0 },
      end: { line: lastLine, character: text.length - lastLineStart },
    },
  };
}

const MEDIA_TYPE_EXT: Record<string, string> = {
  "text/plain": ".txt",
  "text/html": ".html",
  "text/css": ".css",
  "text/javascript": ".js",
  "text/typescript": ".ts",
  "text/markdown": ".md",
  "application/json": ".json",
  "application/yaml": ".yaml",
};

export class CopilotEngine implements ExecutionEngine {
  private readonly sdkAdapter: CopilotSdkAdapter;

  /** Active sessions keyed by executionId. */
  private readonly sessions = new Map<number, CopilotSdkSession>();
  private readonly executionSessionIds = new Map<number, string>();
  private readonly pendingResumes = new Map<number, {
    resolve: (input: EngineResumeInput) => void;
    reject: (error: Error) => void;
  }>();

  constructor(
    _onTaskUpdated: OnTaskUpdated,
    _onNewMessage: OnNewMessage,
    sdkAdapter: CopilotSdkAdapter = createDefaultCopilotSdkAdapter(),
    // cliPath is only used when constructing the default adapter above;
    // when a custom sdkAdapter is injected (tests) this parameter is unused.
  ) {
    this.sdkAdapter = sdkAdapter;
  }

  execute(params: ExecutionParams): AsyncIterable<EngineEvent> {
    return this._run(params);
  }

  async resume(executionId: number, input: EngineResumeInput): Promise<void> {
    const sdkSessionId = this.executionSessionIds.get(executionId);
    if (sdkSessionId) this.sdkAdapter.touchLease(sdkSessionId, "running");
    const pending = this.pendingResumes.get(executionId);
    if (!pending) {
      throw new Error(`Execution ${executionId} is not waiting for resume input`);
    }
    this.pendingResumes.delete(executionId);
    pending.resolve(input);
  }

  private async *_run(params: ExecutionParams): AsyncGenerator<EngineEvent> {
    const { executionId, taskId, boardId, prompt, systemInstructions, taskContext, workingDirectory, model } = params;

    // Collect status messages from the adapter (download/setup progress)
    // so we can yield them as engine events for the UI.
    const pendingStatus: string[] = [];
    const unsubStatus = this.sdkAdapter.onStatus((msg) => pendingStatus.push(msg));

    // Helper: yield any buffered status events.
    const flushStatus = function* (): Generator<EngineEvent> {
      while (pendingStatus.length > 0) {
        yield { type: "status", message: pendingStatus.shift()! };
      }
    };

    // Resolve model from execution params only.
    // Strip the "copilot/" namespace prefix — it's our internal qualifier, the SDK
    // expects the bare model name (e.g. "claude-sonnet-4.6", not "copilot/claude-sonnet-4.6").
    const rawModel = model;
    const resolvedModel = rawModel?.startsWith("copilot/") ? rawModel.slice("copilot/".length) : rawModel;

    // When a suspend-loop tool fires (e.g. interview_me), store the payload and abort
    // the session. The Copilot SDK provides no in-handler stop signal, so we abort
    // externally. The abort cuts the stream before the model generates a next turn.
    let pendingInterviewPayload: string | null = null;
    const interviewAbortController = new AbortController();
    const onSuspend = (payload: string) => {
      pendingInterviewPayload = payload;
      interviewAbortController.abort();
    };

    // Build tool context for common task-management tools
    const config = getConfig();
    const lspManager = taskLspRegistry.getManager(
      taskId,
      config.workspace.lsp?.servers ?? [],
      workingDirectory,
    );
    const toolContext = {
      taskId,
      boardId: boardId ?? 0,
      onTransition: (_tId: number, _state: string) => {
        // Transitions are not directly triggered from Copilot turn; log only
      },
      onHumanTurn: (_tId: number, _msg: string) => {
        // Human turns not triggered from within Copilot execution
      },
      onCancel: (_execId: number) => {
        this.cancel(_execId);
      },
      lspManager,
      worktreePath: workingDirectory,
    };

    const tools = buildCopilotTools(toolContext, getMcpRegistry(), params.enabledMcpTools, onSuspend);

    // Build system message — prepend task identity then append stage_instructions
    const taskBlock = taskContext
      ? [`## Task`, `**Title:** ${taskContext.title}`, ...(taskContext.description ? [`**Description:** ${taskContext.description}`] : [])].join("\n")
      : undefined;
    const systemContent = [taskBlock, systemInstructions].filter(Boolean).join("\n\n");
    const systemMessage = systemContent
      ? { mode: "append" as const, content: systemContent }
      : undefined;

    const sessionConfig = {
      ...(resolvedModel ? { model: resolvedModel } : {}),
      tools,
      ...(systemMessage ? { systemMessage } : {}),
      onPermissionRequest: (_req: unknown, _inv: unknown) => {
        // Approve all — the Copilot agent operates inside our controlled environment
        return { kind: "approved" as const };
      },
      workingDirectory,
      streaming: true,
    };

    // Deterministic session ID — always derived from taskId so context survives
    // process restarts without needing any DB or in-memory state.
    const sdkSessionId = copilotSessionIdForConversation(taskId, params.conversationId);

    let session: CopilotSdkSession | undefined;
    try {
      try {
        yield* flushStatus();
        session = await this.sdkAdapter.resumeSession(sdkSessionId, sessionConfig);
        yield* flushStatus();
      } catch {
        // Session data doesn't exist on disk yet (first run) or was deleted.
        // Create with the same deterministic ID so future runs can always resume it.
        yield* flushStatus();
        session = await this.sdkAdapter.createSession({ sessionId: sdkSessionId, ...sessionConfig });
        yield* flushStatus();
      }

      this.sessions.set(executionId, session);
      this.executionSessionIds.set(executionId, sdkSessionId);
      this.sdkAdapter.touchLease(sdkSessionId, "running");

      // Bail early if the execution was cancelled while we were creating the session
      // (user clicked stop before session creation completed).
      if (params.signal?.aborted) {
        // Abort the session explicitly — cancel() may have run before sessions.set()
        // and therefore couldn't abort it. The finally block handles disconnect.
        await this.sdkAdapter.abortSession(session).catch(() => { });
        return;
      }

      let resolvedInitialPrompt: string;
      try {
        resolvedInitialPrompt = await resolvePrompt(prompt, workingDirectory ?? "");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        yield { type: "error", message: msg, fatal: true };
        return;
      }
      let nextPrompt: string | null = resolvedInitialPrompt;

      while (nextPrompt != null) {
        // Fire the prompt; pass the promise into translateCopilotStream so a rejection
        // (e.g. CLI crash) is surfaced as a fatal error rather than silently hanging.
        // Combine the external abort signal with the interview_me internal abort.
        const combinedController = new AbortController();
        params.signal?.addEventListener("abort", () => combinedController.abort(), { once: true });
        interviewAbortController.signal.addEventListener("abort", () => {
          this.sdkAdapter.abortSession(session!).catch(() => { });
          combinedController.abort();
        }, { once: true });

        const isTextType = (mediaType: string) =>
          mediaType.startsWith("text/") ||
          mediaType === "application/json" ||
          mediaType === "application/yaml";

        const attachments = params.attachments ?? [];

        const mappedAttachments = attachments.map((a): CopilotSdkAttachment => {
          const fileRef = parseFileRef(a.data);
          if (fileRef) {
            const absPath = (workingDirectory && !isAbsolute(fileRef.path))
              ? join(workingDirectory, fileRef.path)
              : fileRef.path;
            const raw = readFileSync(absPath, "utf8");
            let text: string;
            if (fileRef.startLine !== undefined && fileRef.endLine !== undefined) {
              const lines = raw.split("\n");
              text = lines.slice(fileRef.startLine - 1, fileRef.endLine).join("\n");
            } else {
              text = raw;
            }
            return toSelectionAttachment(absPath, a.label, text);
          }
          if (isTextType(a.mediaType)) {
            const text = Buffer.from(a.data, "base64").toString("utf8");
            const ext = a.label.includes(".") ? "" : (MEDIA_TYPE_EXT[a.mediaType] ?? ".txt");
            const tmpDir = join(tmpdir(), "railyin-attachments");
            mkdirSync(tmpDir, { recursive: true });
            const tmpPath = join(tmpDir, `${Date.now()}-${a.label}${ext}`);
            writeFileSync(tmpPath, text, "utf8");
            return toSelectionAttachment(tmpPath, a.label, text);
          }
          return {
            type: "blob",
            data: a.data,
            mimeType: a.mediaType,
            displayName: a.label,
          };
        });

        const sendPromise = session.send({
          prompt: nextPrompt,
          ...(mappedAttachments.length ? { attachments: mappedAttachments } : {}),
        });
        const onWatchdogFire = () => this.sdkAdapter.pingClient(sdkSessionId);
        let paused = false;
        let terminal = false;

        for await (const event of translateCopilotStream(
          session,
          combinedController.signal,
          sendPromise,
          onWatchdogFire,
          (rawEvent) => {
            params.onRawModelMessage?.({
              engine: "copilot",
              sessionId: sdkSessionId,
              direction: "inbound",
              eventType: rawEvent.type,
              payload: rawEvent as unknown as Record<string, unknown>,
            });
          },
        )) {
          if (event.type === "ask_user" || event.type === "shell_approval") {
            this.sdkAdapter.touchLease(sdkSessionId, "waiting_user");
          } else {
            this.sdkAdapter.touchLease(sdkSessionId, "running");
          }
          yield event;

          if (event.type === "ask_user" || event.type === "shell_approval") {
            paused = true;
            break;
          }

          if (
            event.type === "done" ||
            (event.type === "error" && event.fatal)
          ) {
            terminal = true;
            break;
          }
        }

        if (pendingInterviewPayload !== null) {
          yield { type: "interview_me", payload: pendingInterviewPayload };
          return;
        }

        if (params.signal?.aborted || terminal) {
          return;
        }

        if (!paused) {
          return;
        }

        const resumeInput = await this.waitForResume(executionId, params.signal);
        nextPrompt = this.mapResumeInputToPrompt(resumeInput);
      }
    } catch (err) {
      if (
        params.signal?.aborted ||
        (err instanceof Error && (
          err.message.includes("cancelled") ||
          err.message.includes("aborted while waiting for input")
        ))
      ) {
        return;
      }
      yield {
        type: "error",
        message: err instanceof Error ? err.message : String(err),
        fatal: true,
      };
    } finally {
      unsubStatus();
      const pending = this.pendingResumes.get(executionId);
      if (pending) {
        this.pendingResumes.delete(executionId);
        pending.reject(new Error(`Execution ${executionId} was closed before resuming`));
      }
      this.sessions.delete(executionId);
      this.executionSessionIds.delete(executionId);
      if (session) {
        await this.sdkAdapter.disconnectSession(session).catch(() => { });
      }
      // Keep the task lease warm until inactivity timeout. Do not release immediately.
      this.sdkAdapter.setLeaseState(sdkSessionId, "idle");
    }
  }

  cancel(executionId: number): void {
    const pending = this.pendingResumes.get(executionId);
    if (pending) {
      this.pendingResumes.delete(executionId);
      pending.reject(new Error(`Execution ${executionId} cancelled`));
    }
    const session = this.sessions.get(executionId);
    const sdkSessionId = this.executionSessionIds.get(executionId);
    if (session) {
      // Abort the in-progress turn first so the model stops cleanly and the
      // session state on disk stays consistent for future resumption.
      this.sdkAdapter.abortSession(session)
        .catch(() => { })
        .finally(() => this.sdkAdapter.disconnectSession(session).catch(() => { }));
    }
    if (sdkSessionId) this.sdkAdapter.setLeaseState(sdkSessionId, "idle");
    this.sessions.delete(executionId);
    this.executionSessionIds.delete(executionId);
  }

  async shutdown(options: import("../types.ts").EngineShutdownOptions = { reason: "app-exit", deadlineMs: 3_000 }): Promise<void> {
    await this.sdkAdapter.shutdownAll(options).catch(() => { });
  }

  async compact(taskId: number | null, conversationId: number, workingDirectory: string): Promise<void> {
    const sdkSessionId = copilotSessionIdForConversation(taskId, conversationId);
    // Wake the session — same pattern as execution, but we only need to trigger
    // compaction then let the lease manager put it back to sleep.
    const sessionConfig = {
      workingDirectory,
      streaming: true,
      onPermissionRequest: (_req: unknown, _inv: unknown) => ({ kind: "approved" as const }),
    };
    const session = await this.sdkAdapter.resumeSession(sdkSessionId, sessionConfig);
    this.sdkAdapter.touchLease(sdkSessionId, "running");
    try {
      await session.compact();
    } finally {
      await this.sdkAdapter.disconnectSession(session).catch(() => { });
      this.sdkAdapter.setLeaseState(sdkSessionId, "idle");
    }
  }

  async listModels(): Promise<EngineModelInfo[]> {
    let sdkModels;
    try {
      sdkModels = await this.sdkAdapter.listModels();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[copilot] listModels failed:", err instanceof Error ? err.stack ?? err.message : err);
      throw new Error(
        `Copilot CLI failed to start: ${msg}\n\nRailyn automatically downloads the Copilot CLI binary on first use.\nPlease check your internet connection and try again.\n\nIf the problem persists, check the logs at ~/.railyn/logs/bun.log`,
        { cause: err },
      );
    }
    const autoModel: EngineModelInfo = {
      qualifiedId: null,
      displayName: "Auto",
      description: "Copilot will automatically choose the best available model for your request.",
      contextWindow: undefined,
      supportsThinking: false,
      supportsManualCompact: false,
    };

    return [
      autoModel,
      ...sdkModels.map((m) => ({
        qualifiedId: `copilot/${m.id}`,
        displayName: m.name ?? m.id,
        contextWindow: m.capabilities.limits.max_context_window_tokens,
        supportsThinking: m.capabilities.supports.reasoningEffort,
        supportsManualCompact: false,
      })),
    ];
  }

  async listCommands(taskId: number): Promise<CommandInfo[]> {
    const { getDb } = await import("../../db/index.ts");
    const { getBoardWorkspaceKey } = await import("../../workspace-context.ts");
    const { getProjectByKey } = await import("../../project-store.ts");

    const db = getDb();
    const taskRow = db
      .query<{ board_id: number; project_key: string }, [number]>(
        "SELECT board_id, project_key FROM tasks WHERE id = ?",
      )
      .get(taskId);

    const gitRow = db
      .query<{ worktree_path: string | null }, [number]>(
        "SELECT worktree_path FROM task_git_context WHERE task_id = ?",
      )
      .get(taskId);

    const worktreePath = gitRow?.worktree_path ?? process.cwd();

    let projectPath: string | null = null;
    if (taskRow) {
      const wsKey = getBoardWorkspaceKey(taskRow.board_id);
      const project = getProjectByKey(wsKey, taskRow.project_key);
      if (project?.projectPath && project.projectPath !== worktreePath) {
        projectPath = project.projectPath;
      }
    }

    const userPath = join(homedir(), ".github", "prompts");

    const seen = new Set<string>();
    const commands: CommandInfo[] = [];

    collectCopilotCommands(join(worktreePath, ".github", "prompts"), seen, commands);

    if (projectPath && projectPath !== worktreePath) {
      collectCopilotCommands(join(projectPath, ".github", "prompts"), seen, commands);
    }

    collectCopilotCommands(userPath, seen, commands);

    return commands;
  }

  private waitForResume(executionId: number, signal?: AbortSignal): Promise<EngineResumeInput> {
    return new Promise<EngineResumeInput>((resolve, reject) => {
      const existing = this.pendingResumes.get(executionId);
      if (existing) {
        reject(new Error(`Execution ${executionId} is already waiting for resume input`));
        return;
      }

      const cleanup = () => {
        signal?.removeEventListener("abort", onAbort);
        this.pendingResumes.delete(executionId);
      };

      const onAbort = () => {
        cleanup();
        reject(new Error(`Execution ${executionId} aborted while waiting for input`));
      };

      signal?.addEventListener("abort", onAbort, { once: true });
      this.pendingResumes.set(executionId, {
        resolve: (input) => {
          cleanup();
          resolve(input);
        },
        reject: (error) => {
          cleanup();
          reject(error);
        },
      });
    });
  }

  private mapResumeInputToPrompt(input: EngineResumeInput): string {
    switch (input.type) {
      case "ask_user":
        return input.content;
      case "shell_approval":
        return input.decision === "deny"
          ? "The requested shell command was denied by the user. Adjust your plan and continue without it."
          : input.decision === "approve_all"
            ? "The requested shell command was approved for this and similar commands. Continue."
            : "The requested shell command was approved once. Continue.";
    }
  }
}

// ─── Copilot command discovery ────────────────────────────────────────────────

/** Extract `description` value from YAML frontmatter (`---\ndescription: ...\n---`). */
function parseFrontmatterDescription(filePath: string): string | undefined {
  try {
    const content = readFileSync(filePath, "utf8");
    const match = content.match(/^---[\r\n]([\s\S]*?)[\r\n]---/);
    if (!match) return undefined;
    const descLine = match[1].match(/^description:\s*(.+)$/m);
    return descLine ? descLine[1].trim() : undefined;
  } catch {
    return undefined;
  }
}

export function collectCopilotCommands(dir: string, seen: Set<string>, out: CommandInfo[]): void {
  if (!existsSync(dir)) return;
  let entries: import("fs").Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith(".prompt.md")) {
      const commandName = basename(entry.name, ".prompt.md");
      if (!seen.has(commandName)) {
        seen.add(commandName);
        out.push({ name: commandName, description: parseFrontmatterDescription(join(dir, entry.name)) });
      }
    }
  }
}
