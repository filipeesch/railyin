/**
 * Delegate fan-out tool for the Pi engine.
 *
 * Spawns independent child agent sessions in parallel, collects their results,
 * and returns a markdown digest to the parent. Child events (tool calls) are
 * forwarded to the parent stream as isInternal events so the UI can render
 * them as nested collapsible cards (S-26 pattern).
 */

import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import type { HarnessContext } from "../harness/context.ts";
import type { EngineEvent } from "../../types.ts";
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
  engineConfig?: PiEngineConfig;
  /** Builds tools for child sessions — injected by buildAllTools to avoid circular imports. */
  buildChildTools?: (groups: string[]) => AgentTool<any>[];
}

type DelegateTask = { id: string; intent?: string; prompt: string; tools?: string[] };

export function buildDelegateTool(_harnessCtx: HarnessContext, opts: DelegateToolOptions): AgentTool<any>[] {
  const {
    limiterRegistry,
    parentModel,
    parentCwd,
    engineConfig,
    delegateEmitRef,
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
              intent: {
                type: "string",
                description:
                  "Verb phrase (≤8 words) shown as the bubble header in the UI. " +
                  "Must start with an action verb describing what this agent does. " +
                  'Examples: "Analyze authentication module structure", "Map exported functions in utilities", ' +
                  '"Find database schema and migrations". ' +
                  "Do NOT use service names or file paths as the intent.",
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
              tools: {
                type: "array",
                items: { type: "string", enum: ["read", "web"] },
                description:
                  'Tool groups available to this child. Defaults to config.allow_tools ?? ["read"]. ' +
                  "Do not include shell — shell state is shared and not safe to parallelise.",
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
    ): Promise<AgentToolResult<undefined>> => {
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

      const providerName = model.provider;
      const providerSnapshot = registry.snapshot(providerName);
      const effectiveConcurrency =
        delegateConfig?.max_concurrency ?? Math.min(maxPerCall, providerSnapshot?.maxInflight ?? maxPerCall);

      const tasks = args.tasks;
      let taskPtr = 0;
      const results = new Array<PromiseSettledResult<{ id: string; text: string }>>(tasks.length);

      async function runChildTask(task: DelegateTask, idx: number): Promise<void> {
        if (signal?.aborted) {
          results[idx] = { status: "rejected", reason: new DOMException("Aborted", "AbortError") };
          return;
        }

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
            cwd,
          });

          // Subscribe BEFORE prompting to capture all child events.
          // Route child tool calls under childBlockId so they nest inside the per-child subagent bubble.
          unsubscribe = handle.session.subscribe((event: AgentSessionEvent) => {
            if (!delegateEmitRef?.emit) return;
            const engineEvents = translateEvent(event as any, cwd);
            for (const ev of engineEvents) {
              if (ev.type === "tool_start" || ev.type === "tool_result") {
                delegateEmitRef.emit({ ...ev, parentCallId: childBlockId, isInternal: true });
              }
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

      return { content: [{ type: "text", text: lines.join("\n") }], details: undefined };
    },
  };

  return [tool];
}
