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

type DelegateTask = { id: string; prompt: string; tools?: string[] };

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
      "Fan out independent sub-tasks to parallel child agents. " +
      "Each child receives its own prompt and a restricted tool set. " +
      "Results are returned as a markdown digest.",
    parameters: {
      type: "object",
      properties: {
        tasks: {
          type: "array",
          description: "Sub-tasks to run in parallel. Each becomes an independent child agent call.",
          items: {
            type: "object",
            properties: {
              id: { type: "string", description: "Unique identifier for this sub-task (used in the result digest)." },
              prompt: { type: "string", description: "Instruction for the child agent." },
              tools: {
                type: "array",
                items: { type: "string", enum: ["read", "web"] },
                description: 'Tool groups available to this child. Defaults to config.allow_tools ?? ["read"].',
              },
            },
            required: ["id", "prompt"],
          },
        },
        description: {
          type: "string",
          description: "Human-readable summary of the fan-out purpose.",
        },
      },
      required: ["tasks"],
    },
    execute: async (
      toolCallId: string,
      _rawArgs: unknown,
      signal?: AbortSignal,
    ): Promise<AgentToolResult<undefined>> => {
      const args = _rawArgs as { tasks: DelegateTask[]; description?: string };
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

        const childGroups = (task.tools ?? delegateConfig?.allow_tools ?? ["read"]).filter((g) => g !== "delegate");
        const childTools = buildChildTools(childGroups);

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
          unsubscribe = handle.session.subscribe((event: AgentSessionEvent) => {
            if (!delegateEmitRef?.emit) return;
            const engineEvents = translateEvent(event as any, cwd);
            for (const ev of engineEvents) {
              if (ev.type === "tool_start" || ev.type === "tool_result") {
                delegateEmitRef.emit({ ...ev, parentCallId: toolCallId, isInternal: true });
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
        } catch (err) {
          results[idx] = {
            status: "rejected",
            reason: err instanceof Error ? err : new Error(String(err)),
          };
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
