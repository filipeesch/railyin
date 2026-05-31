/**
 * Delegate fan-out tool for the Pi engine.
 *
 * Spawns independent child agent sessions in parallel, collects their results,
 * and returns a markdown digest to the parent. Child events (tool calls) are
 * forwarded to the parent stream as isInternal events so the UI can render
 * them as nested collapsible cards (S-26 pattern).
 */

import { join, isAbsolute, resolve } from "node:path";
import { statSync } from "node:fs";
import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import type { HarnessContext } from "../harness/context.ts";
import type { EngineEvent, RawModelMessage } from "../../types.ts";
import type { ChildSessionFactory } from "../child-session.ts";
import type { ProviderLimiterRegistry } from "../provider-limiter.ts";
import type { PiEngineConfig } from "../../../config/index.ts";
import type { Model } from "@earendil-works/pi-ai";
import { defaultChildSessionFactory } from "../child-session.ts";
import { runWithLimiter } from "../provider-transport.ts";
import { translateEvent } from "../event-translator.ts";
import { formatPiError } from "../pi-error.ts";

export interface DelegateToolOptions {
  delegateEmitRef?: { emit?: (event: EngineEvent) => void };
  childSessionFactory?: ChildSessionFactory;
  limiterRegistry?: ProviderLimiterRegistry;
  parentModel?: Model<"openai-completions">;
  parentSystemPrompt?: string;
  parentCwd?: string;
  parentConversationId?: number;
  engineConfig?: PiEngineConfig;
  /** Callback for forwarding child raw-model events to the parent's observability pipeline. */
  onRawModelMessage?: (message: RawModelMessage) => void;
  /** Builds tools for child sessions — injected by buildAllTools to avoid circular imports. */
  buildChildTools?: (groups: string[]) => AgentTool<any>[];
}

type DelegateTask = { id: string; intent?: string; prompt: string; tools?: string[]; workingDirectory?: string };

interface DelegateJobSummary {
  id: string;
  status: "ok" | "error";
  durationMs: number;
  tokens?: number;
}

export function buildDelegateTool(_harnessCtx: HarnessContext, opts: DelegateToolOptions): AgentTool<any>[] {
  const {
    limiterRegistry,
    parentModel,
    parentCwd,
    parentConversationId,
    engineConfig,
    delegateEmitRef,
    onRawModelMessage,
    childSessionFactory = defaultChildSessionFactory,
    buildChildTools = () => [],
  } = opts;

  if (!limiterRegistry || !parentModel || !parentCwd || !engineConfig) {
    return [];
  }

  const delegateConfig = engineConfig.harness?.delegate;
  if (delegateConfig?.enabled === false) {
    return [];
  }

  // After the guard above, these are guaranteed non-undefined.
  const registry = limiterRegistry;
  const model = parentModel;
  const cwd = parentCwd;
  const config = engineConfig;

  const maxPerCall = Math.max(1, Math.min(10, delegateConfig?.max_per_call ?? 5));

  const tool: AgentTool<any> = {
    name: "delegate",
    label: "Delegate tasks",
    description:
      "Fan out 2+ independent sub-tasks to parallel child agents and receive a markdown digest of all results.\n\n" +
      "WHEN TO USE\n" +
      "- You can split the work into tasks with no shared files and no sequential dependency between them.\n" +
      "- Each task can be fully described without referencing another task's output.\n" +
      "- You have at least 2 tasks (for a single task, just do it yourself).\n\n" +
      "DO NOT DELEGATE IF\n" +
      "- Two tasks touch the same file (last-write-wins, no merge).\n" +
      "- Task B needs Task A's output as input.\n" +
      "- Tasks share mutable state (lock files, package.json, git index).\n" +
      "- Tasks need shell commands — shell state is global, not safe to parallelise.",
    parameters: {
      type: "object",
      properties: {
        tasks: {
          type: "array",
          description: "Sub-tasks to run in parallel. Each becomes an independent child agent call.",
          items: {
            type: "object",
            properties: {
              id: {
                type: "string",
                description:
                  "Short slug naming the scope. Use the file stem when possible, " +
                  'e.g. "auth-token" or "user-service-tests". If you cannot name it in 3–5 words the task is too broad.',
              },
              prompt: {
                type: "string",
                description:
                  "Self-contained brief for a fresh agent with no prior context. " +
                  "Structure it with these sections:\n" +
                  "GOAL: one sentence stating exactly what to produce.\n" +
                  "SCOPE: explicit file paths or directories to look at — be specific.\n" +
                  "OUT OF SCOPE: what to skip even if encountered (avoids rabbit holes).\n" +
                  "DONE WHEN: a concrete, checkable condition — the agent stops as soon as this is met.\n" +
                  "OUTPUT FORMAT: how to return the result (e.g. markdown summary, bullet list of findings, code snippet).\n" +
                  "The child has no conversation history — everything it needs must be in this prompt.",
              },
              intent: {
                type: "string",
                description:
                  "Describe the ACTION being performed, not the system being examined. " +
                  "Format: <action verb> + <what you are looking for> + <where (optional)>. " +
                  "Keep it ≤8 words.\n" +
                  "BAD — names the system:  'payment-service', 'OrderRepository', 'config module'\n" +
                  "BAD — vague:             'Analyze code', 'Check implementation'\n" +
                  "GOOD:                    'Map error handling in payment flow'\n" +
                  "GOOD:                    'Find DB queries in order repository'\n" +
                  "GOOD:                    'Trace config loading across modules'",
              },
              tools: {
                type: "array",
                items: { type: "string", enum: ["read", "web"] },
                description:
                  'Tool groups available to this child. Defaults to config.allow_tools ?? ["read"]. ' +
                  "Do not include shell — shell state is shared and not safe to parallelise.",
              },
              workingDirectory: {
                type: "string",
                description:
                  "Optional subdirectory (relative path) to scope this child agent's working directory. " +
                  "All file tools (read, glob, grep) will resolve paths relative to this directory, " +
                  "bounding the agent to that subtree — it cannot read files outside it. " +
                  "Must be a relative path inside the project root (no leading slash, no '..' escapes). " +
                  'Example: "src/auth" scopes the child to the auth module only.',
              },
            },
            required: ["id", "prompt"],
          },
        },
      },
      required: ["tasks"],
    },
    execute: async (
      toolCallId: string,
      _rawArgs: unknown,
      signal?: AbortSignal,
    ): Promise<AgentToolResult<{ jobs: DelegateJobSummary[] } | undefined>> => {
      const args = _rawArgs as { tasks: DelegateTask[] };
      if (args.tasks.length > maxPerCall) {
        return {
          content: [
            {
              type: "text",
              text: `Error: too many tasks (${args.tasks.length}). Maximum allowed per delegate call is ${maxPerCall}.`,
            },
          ],
          details: undefined,
        };
      }

      const emptyIdTask = args.tasks.find((t) => !t.id || t.id.trim() === "");
      if (emptyIdTask !== undefined) {
        return {
          content: [{ type: "text", text: "Error: every task must have a non-empty id." }],
          details: undefined,
        };
      }

      const ids = args.tasks.map((t) => t.id);
      const duplicateId = ids.find((id, i) => ids.indexOf(id) !== i);
      if (duplicateId !== undefined) {
        return {
          content: [{ type: "text", text: `Error: duplicate task id "${duplicateId}". All task ids must be unique.` }],
          details: undefined,
        };
      }

      const allowedGroups = new Set(delegateConfig?.allow_tools ?? ["read"]);
      allowedGroups.add("read"); // read is always allowed
      for (const task of args.tasks) {
        if (!task.tools) continue;
        const rejected = task.tools.filter((g) => !allowedGroups.has(g) && g !== "delegate");
        if (rejected.length > 0) {
          return {
            content: [
              {
                type: "text",
                text: `Error: task "${task.id}" requests disallowed tool group(s): ${rejected.join(", ")}. Allowed: ${[...allowedGroups].join(", ")}.`,
              },
            ],
            details: undefined,
          };
        }
      }

      // Validate per-task workingDirectory paths before launching any child.
      for (const task of args.tasks) {
        if (!task.workingDirectory) continue;
        const error = validateChildWorkingDirectory(cwd, task.workingDirectory);
        if (error) {
          return {
            content: [{ type: "text", text: `Error: task "${task.id}" has invalid workingDirectory — ${error}` }],
            details: undefined,
          };
        }
      }

      const providerName = model.provider;
      const providerSnapshot = registry.snapshot(providerName);
      const effectiveConcurrency =
        delegateConfig?.max_concurrency ?? Math.min(maxPerCall, providerSnapshot?.maxInflight ?? maxPerCall);

      const tasks = args.tasks;
      let taskPtr = 0;
      const results = new Array<PromiseSettledResult<{ id: string; text: string }>>(tasks.length);
      const jobSummaries = new Array<DelegateJobSummary>(tasks.length);

      async function runChildTask(task: DelegateTask, idx: number): Promise<void> {
        const startMs = Date.now();
        if (signal?.aborted) {
          results[idx] = { status: "rejected", reason: new DOMException("Aborted", "AbortError") };
          jobSummaries[idx] = { id: task.id, status: "error", durationMs: Date.now() - startMs };
          return;
        }

        const childCwd = task.workingDirectory ? join(cwd, task.workingDirectory) : cwd;
        const childBlockId = `child-${task.id}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const childGroups = (task.tools ?? delegateConfig?.allow_tools ?? ["read"]).filter((g) => g !== "delegate");
        const childTools = buildChildTools(childGroups);

        // Emit a subagent_start event to give each child its own root-level bubble.
        delegateEmitRef?.emit?.({
          type: "subagent_start",
          callId: childBlockId,
          intent: task.intent ?? task.id,
          prompt: task.prompt,
        });

        let handle: Awaited<ReturnType<ChildSessionFactory>> | null = null;
        let unsubscribe: (() => void) | null = null;

        try {
          handle = await childSessionFactory({
            jobId: task.id,
            tools: childTools,
            model,
            config,
            parentSystemPrompt: opts.parentSystemPrompt,
            cwd: childCwd,
          });

          // Subscribe BEFORE prompting to capture all child events.
          // - UI path: route tool_start/tool_result under childBlockId so they nest in the per-child bubble.
          // - Observability path: forward raw inbound events via onRawModelMessage tagged with the delegate callId.
          const childSessionId = parentConversationId != null ? `${parentConversationId}/${task.id}` : task.id;
          unsubscribe = handle.session.subscribe((event: AgentSessionEvent) => {
            if (delegateEmitRef?.emit) {
              const engineEvents = translateEvent(event as any, cwd);
              for (const ev of engineEvents) {
                if (ev.type === "tool_start" || ev.type === "tool_result") {
                  delegateEmitRef.emit({ ...ev, parentCallId: childBlockId, isInternal: true });
                }
              }
            }

            if (onRawModelMessage) {
              onRawModelMessage({
                engine: "pi",
                sessionId: childSessionId,
                parentToolCallId: toolCallId,
                direction: "inbound",
                eventType: event.type,
                payload: event as unknown as Record<string, unknown>,
              });
            }
          });

          await runWithLimiter(registry, providerName, signal, () => handle!.session.prompt(task.prompt));

          const messages = handle.session.agent.state.messages as Array<{
            role: string;
            content?: Array<{ type: string; text?: string }>;
          }>;
          const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
          const text =
            lastAssistant?.content
              ?.filter((c) => c.type === "text")
              .map((c) => c.text ?? "")
              .join("") ?? "(no result)";

          results[idx] = { status: "fulfilled", value: { id: task.id, text } };
          const usage = handle.session.getContextUsage?.();
          jobSummaries[idx] = { id: task.id, status: "ok", durationMs: Date.now() - startMs, tokens: usage?.tokens };

          // Close the subagent bubble as succeeded (no parentCallId → root level).
          delegateEmitRef?.emit?.({
            type: "tool_result",
            name: "subagent",
            callId: childBlockId,
            result: text,
            isInternal: false,
          });
        } catch (err) {
          const isAbort = err instanceof DOMException && err.name === "AbortError";
          results[idx] = {
            status: "rejected",
            reason: err instanceof Error ? err : new Error(String(err)),
          };
          jobSummaries[idx] = { id: task.id, status: "error", durationMs: Date.now() - startMs };

          // Close the subagent bubble as errored (no parentCallId → root level).
          delegateEmitRef?.emit?.({
            type: "tool_result",
            name: "subagent",
            callId: childBlockId,
            result: isAbort ? "Aborted" : formatPiError(err instanceof Error ? err : new Error(String(err))),
            isError: true,
            isInternal: false,
          });
        } finally {
          unsubscribe?.();
          handle?.dispose();
        }
      }

      async function worker(): Promise<void> {
        // Atomically claim the next task index — safe in single-threaded JS (no await between check and increment).
        while (true) {
          const i = taskPtr;
          if (i >= tasks.length) break;
          taskPtr++;
          await runChildTask(tasks[i], i);
        }
      }

      const numWorkers = Math.min(effectiveConcurrency, tasks.length);
      await Promise.all(Array.from({ length: numWorkers }, () => worker()));

      const lines: string[] = ["## Delegate Results"];
      for (let i = 0; i < tasks.length; i++) {
        lines.push(`\n### Job: ${tasks[i].id}`);
        const result = results[i];
        if (result?.status === "fulfilled") {
          lines.push(result.value.text);
        } else if (result?.status === "rejected") {
          const err = result.reason instanceof Error ? result.reason : new Error(String(result.reason ?? "unknown error"));
          lines.push(`Error: ${formatPiError(err)}`);
        } else {
          lines.push("(task did not execute)");
        }
      }

      return { content: [{ type: "text", text: lines.join("\n") }], details: { jobs: jobSummaries } };
    },
  };

  return [tool];
}

/**
 * Validates a per-task workingDirectory value against the parent cwd.
 * Returns an error message string if invalid, or null if valid.
 *
 * Rules:
 *  1. Must be a relative path (no leading slash).
 *  2. Resolved path must remain inside parentCwd (no ".." escapes).
 *  3. The resolved directory must exist.
 */
function validateChildWorkingDirectory(parentCwd: string, childRelPath: string): string | null {
  if (isAbsolute(childRelPath)) {
    return `path must be relative, not absolute ("${childRelPath}")`;
  }
  const resolved = resolve(join(parentCwd, childRelPath));
  if (!resolved.startsWith(parentCwd + "/") && resolved !== parentCwd) {
    return `path escapes the project root ("${childRelPath}")`;
  }
  try {
    const stat = statSync(resolved);
    if (!stat.isDirectory()) {
      return `path is not a directory ("${childRelPath}")`;
    }
  } catch {
    return `directory does not exist ("${childRelPath}")`;
  }
  return null;
}
