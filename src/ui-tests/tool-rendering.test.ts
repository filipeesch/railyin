import { beforeAll, describe, expect, test } from "bun:test";
import { openTaskDrawer, seedToolMessages, setupTestEnv, sleep, webClick, webEval } from "./bridge";

let taskId: number;

beforeAll(async () => {
  const env = await setupTestEnv();
  taskId = env.taskId;
});

async function openSeededScenario(scenario: "batched" | "copilot-diff" | "subagent" | "timeout") {
  await seedToolMessages(taskId, scenario);
  await openTaskDrawer(taskId);
}

describe("Suite S — tool rendering regressions", () => {
  test("S-24: batched tool calls pair results by id, preserving call order", async () => {
    await openSeededScenario("batched");
    await webClick(".conversation-inner > .tcg:nth-of-type(1) > .tcg__header");
    await webClick(".conversation-inner > .tcg:nth-of-type(2) > .tcg__header");
    await webClick(".conversation-inner > .tcg:nth-of-type(3) > .tcg__header");
    await webClick(".conversation-inner > .tcg:nth-of-type(4) > .tcg__header");
    await sleep(150);

    const cards = await webEval<Array<{ tool: string; arg: string; body: string }>>(`
      return JSON.stringify(
        Array.from(document.querySelectorAll('.conversation-inner > .tcg')).map((card) => ({
          tool: card.querySelector('.tcg__tool-name')?.textContent?.trim() ?? '',
          arg: card.querySelector('.tcg__primary-arg')?.textContent?.trim() ?? '',
          body: card.querySelector('.tcg__body')?.textContent?.replace(/\\s+/g, ' ').trim() ?? '',
        }))
      );
    `);

    expect(cards).toHaveLength(4);
    expect(cards.map((card) => card.tool)).toEqual(["read_file", "read_file", "read_file", "read_file"]);
    expect(cards.map((card) => card.arg)).toEqual(["alpha.ts", "beta.ts", "gamma.ts", "delta.ts"]);
    expect(cards.map((card) => card.body.replace(/^\d+/, ""))).toEqual([
      "RESULT:alpha.ts",
      "RESULT:beta.ts",
      "RESULT:gamma.ts",
      "RESULT:delta.ts",
    ]);
  });

  test("S-25: Copilot-style rawDiff payload renders as a parsed file diff", async () => {
    await openSeededScenario("copilot-diff");
    await webClick(".conversation-inner > .tcg > .tcg__header");
    await sleep(150);

    const diff = await webEval<{
      added: string;
      removed: string;
      addedLine: string;
      removedLine: string;
    }>(`
      return JSON.stringify({
        added: document.querySelector('.tcg__stat--added')?.textContent?.trim() ?? '',
        removed: document.querySelector('.tcg__stat--removed')?.textContent?.trim() ?? '',
        addedLine: document.querySelector('.fdiff__line--added .fdiff__content')?.textContent?.trim() ?? '',
        removedLine: document.querySelector('.fdiff__line--removed .fdiff__content')?.textContent?.trim() ?? '',
      });
    `);

    expect(diff.added).toBe("+1");
    expect(diff.removed).toBe("-1");
    expect(diff.addedLine).toContain("return 'alpha'");
    expect(diff.removedLine).toContain("return 1");
  });

  test("S-26: subagent tool calls render nested under spawn_agent", async () => {
    await openSeededScenario("subagent");

    const collapsed = await webEval<{ topLevel: number; badge: string; nested: number }>(`
      return JSON.stringify({
        topLevel: document.querySelectorAll('.conversation-inner > .tcg').length,
        badge: document.querySelector('.conversation-inner > .tcg .tcg__badge')?.textContent?.replace(/\\s+/g, ' ').trim() ?? '',
        nested: document.querySelectorAll('.conversation-inner > .tcg .tcg__children > .tcg').length,
      });
    `);

    expect(collapsed.topLevel).toBe(1);
    expect(collapsed.badge).toContain("3");
    expect(collapsed.nested).toBe(0);

    await webClick(".conversation-inner > .tcg > .tcg__header");
    await sleep(150);

    const expanded = await webEval<string[]>(`
      return JSON.stringify(
        Array.from(document.querySelectorAll('.conversation-inner > .tcg .tcg__children > .tcg .tcg__tool-name'))
          .map((el) => el.textContent?.trim() ?? '')
      );
    `);

    expect(expanded).toEqual(["read_file", "list_dir", "edit_file"]);
  });

  test("S-27: stale orphaned tool call shows unknown state instead of spinning forever", async () => {
    await openSeededScenario("timeout");

    const classes = await webEval<string[]>(`
      return JSON.stringify(
        Array.from(document.querySelector('.conversation-inner > .tcg .tcg__tool-icon')?.classList ?? [])
      );
    `);

    expect(classes).toContain("pi-question-circle");
    expect(classes).not.toContain("pi-spin");
  });
});
