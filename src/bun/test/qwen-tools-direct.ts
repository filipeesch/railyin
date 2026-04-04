/**
 * Direct API test for Qwen tool-call behavior.
 * Usage: bun run src/bun/test/qwen-tools-direct.ts
 *
 * Tests:
 *  1. Non-streaming tool call
 *  2. Non-streaming with tool result
 *  3. Streaming — inspect raw deltas (with/without enable_thinking)
 *  4. Streaming multi-turn with tool result — does model actually use results?
 *  5. Realistic system prompt simulation (matches engine context)
 */
const BASE_URL = "http://192.168.86.129:1234";
const MODEL = "qwen/qwen3.5-9b";

async function nonStream(messages: unknown[], tools: unknown[] = [], thinkingEnabled = false) {
  const body: Record<string, unknown> = { model: MODEL, messages, stream: false, enable_thinking: thinkingEnabled };
  if (tools.length) { body.tools = tools.map((t) => ({ type: "function", function: t })); body.tool_choice = "auto"; }
  return (await fetch(`${BASE_URL}/v1/chat/completions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).json();
}

async function streaming(messages: unknown[], tools: unknown[] = [], thinkingEnabled = false): Promise<Record<string, unknown>[]> {
  const body: Record<string, unknown> = { model: MODEL, messages, stream: true, enable_thinking: thinkingEnabled };
  if (tools.length) { body.tools = tools.map((t) => ({ type: "function", function: t })); body.tool_choice = "auto"; }
  const res = await fetch(`${BASE_URL}/v1/chat/completions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  const events: Record<string, unknown>[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    for (const line of dec.decode(value, { stream: true }).split("\n")) {
      const t = line.trim();
      if (!t || t === "data: [DONE]" || !t.startsWith("data: ")) continue;
      try { events.push(JSON.parse(t.slice(6))); } catch { /* ignore */ }
    }
  }
  return events;
}

function accumulateToolCalls(events: Record<string, unknown>[]) {
  const acc: Record<number, { id: string; type: string; function: { name: string; arguments: string } }> = {};
  for (const e of events) {
    const tcs = (e as any).choices?.[0]?.delta?.tool_calls;
    if (!tcs) continue;
    for (const tc of tcs) {
      if (!acc[tc.index]) acc[tc.index] = { id: tc.id ?? "", type: "function", function: { name: tc.function?.name ?? "", arguments: tc.function?.arguments ?? "" } };
      else {
        if (tc.function?.name) acc[tc.index].function.name += tc.function.name;
        if (tc.function?.arguments) acc[tc.index].function.arguments += tc.function.arguments;
      }
    }
  }
  return Object.values(acc);
}

function describeEvents(evs: any[]) {
  const textDeltas = evs.filter((e) => e.choices?.[0]?.delta?.content);
  const toolDeltas = evs.filter((e) => e.choices?.[0]?.delta?.tool_calls?.length);
  const finishEvs = evs.filter((e) => e.choices?.[0]?.finish_reason);
  const rawText = textDeltas.map((e) => e.choices[0].delta.content).join("");
  return {
    total: evs.length, textDeltaCount: textDeltas.length, toolDeltaCount: toolDeltas.length,
    finishReasons: finishEvs.map((e) => e.choices[0].finish_reason),
    rawText,
    hasThink: rawText.includes("<think>"),
    hasXmlToolCall: rawText.includes("<tool_call>"),
    toolCalls: accumulateToolCalls(evs),
  };
}

const tools = [{
  name: "list_dir",
  description: "List files and directories at the given path.",
  parameters: { type: "object", properties: { path: { type: "string", description: "Absolute directory path" } }, required: ["path"] },
}];

// ── TEST 1: Non-streaming ───────────────────────────────────────────────────
console.log("\n=== TEST 1: Non-streaming tool call ===");
const r1: any = await nonStream([{ role: "user", content: "List /tmp using list_dir." }], tools);
const m1 = r1.choices?.[0]?.message;
console.log("finish_reason:", r1.choices?.[0]?.finish_reason);
console.log("tool_calls:", JSON.stringify(m1?.tool_calls));
console.log("content:", JSON.stringify(m1?.content));

// ── TEST 2: Non-streaming — round 2 with tool result ─────────────────────
if (m1?.tool_calls?.length) {
  console.log("\n=== TEST 2: Non-streaming with tool result ===");
  const tc = m1.tool_calls[0];
  const r2: any = await nonStream([
    { role: "user", content: "List /tmp using list_dir." },
    { role: "assistant", content: m1.content ?? null, tool_calls: [tc] },
    { role: "tool", tool_call_id: tc.id, name: tc.function.name, content: "alpha.txt\nbeta.log\ngamma.db" },
  ], tools);
  const m2 = r2.choices?.[0]?.message;
  console.log("finish_reason:", r2.choices?.[0]?.finish_reason);
  console.log("mentions alpha:", m2?.content?.includes("alpha"));
  console.log("response:", m2?.content?.slice(0, 300));
}

// ── TEST 3: Streaming raw — enable_thinking=false ─────────────────────────
console.log("\n=== TEST 3: Streaming, enable_thinking=false ===");
const evs3 = await streaming([{ role: "user", content: "List /tmp using list_dir." }], tools, false);
const d3 = describeEvents(evs3);
console.log(`total=${d3.total} text_deltas=${d3.textDeltaCount} tool_deltas=${d3.toolDeltaCount} finish=${JSON.stringify(d3.finishReasons)}`);
console.log("hasThink:", d3.hasThink, "hasXmlToolCall:", d3.hasXmlToolCall);
console.log("rawText:", JSON.stringify(d3.rawText.slice(0, 200)));
console.log("toolCalls:", JSON.stringify(d3.toolCalls));

// ── TEST 4: Streaming raw — enable_thinking=true ──────────────────────────
console.log("\n=== TEST 4: Streaming, enable_thinking=true ===");
const evs4 = await streaming([{ role: "user", content: "List /tmp using list_dir." }], tools, true);
const d4 = describeEvents(evs4);
console.log(`total=${d4.total} text_deltas=${d4.textDeltaCount} tool_deltas=${d4.toolDeltaCount} finish=${JSON.stringify(d4.finishReasons)}`);
console.log("hasThink:", d4.hasThink, "hasXmlToolCall:", d4.hasXmlToolCall);
console.log("rawText:", JSON.stringify(d4.rawText.slice(0, 200)));
console.log("toolCalls:", JSON.stringify(d4.toolCalls));

// ── TEST 5: Streaming multi-turn with result (enable_thinking=false) ──────
if (d3.toolCalls.length) {
  console.log("\n=== TEST 5: Streaming round 2 with tool result (enable_thinking=false) ===");
  const tc3 = d3.toolCalls[0];
  const evs5 = await streaming([
    { role: "user", content: "List /tmp using list_dir." },
    { role: "assistant", content: d3.rawText || null, tool_calls: d3.toolCalls },
    { role: "tool", tool_call_id: tc3.id, name: tc3.function.name, content: "alpha.txt\nbeta.log\ngamma.db" },
  ], tools, false);
  const d5 = describeEvents(evs5);
  console.log(`total=${d5.total} text_deltas=${d5.textDeltaCount} tool_deltas=${d5.toolDeltaCount} finish=${JSON.stringify(d5.finishReasons)}`);
  console.log("hasThink:", d5.hasThink, "mentions alpha:", d5.rawText.includes("alpha"));
  console.log("rawText:", JSON.stringify(d5.rawText.slice(0, 400)));
}

// ── TEST 6: Same but enable_thinking=true ─────────────────────────────────
if (d4.toolCalls.length) {
  console.log("\n=== TEST 6: Streaming round 2 with tool result (enable_thinking=true) ===");
  const tc4 = d4.toolCalls[0];
  const evs6 = await streaming([
    { role: "user", content: "List /tmp using list_dir." },
    { role: "assistant", content: d4.rawText || null, tool_calls: d4.toolCalls },
    { role: "tool", tool_call_id: tc4.id, name: tc4.function.name, content: "alpha.txt\nbeta.log\ngamma.db" },
  ], tools, true);
  const d6 = describeEvents(evs6);
  console.log(`total=${d6.total} text_deltas=${d6.textDeltaCount} tool_deltas=${d6.toolDeltaCount} finish=${JSON.stringify(d6.finishReasons)}`);
  console.log("hasThink:", d6.hasThink, "mentions alpha:", d6.rawText.includes("alpha"));
  console.log("rawText:", JSON.stringify(d6.rawText.slice(0, 400)));
}

// ── TEST 7: Simulate realistic engine messages (system prompt + worktree) ─
console.log("\n=== TEST 7: Realistic engine context ===");
const SYSTEM_PROMPT = `You are an AI coding agent. Your job is to help implement software tasks.
You are in the Planning phase. Do NOT write code or implementation details.
Focus only on understanding the problem and defining what needs to be done.
The worktree is at: /home/filipe/railyin/worktrees/task/16-dark-mode
Use tools to explore the codebase, then produce a clear implementation plan.`;

const evs7 = await streaming([
  { role: "system", content: SYSTEM_PROMPT },
  { role: "user", content: "help me plan a dark mode feature in my app" },
], tools, false);
const d7 = describeEvents(evs7);
console.log(`total=${d7.total} text_deltas=${d7.textDeltaCount} tool_deltas=${d7.toolDeltaCount} finish=${JSON.stringify(d7.finishReasons)}`);
console.log("hasThink:", d7.hasThink, "toolCalls:", JSON.stringify(d7.toolCalls));
console.log("rawText:", JSON.stringify(d7.rawText.slice(0, 300)));

if (d7.toolCalls.length) {
  console.log("\n=== TEST 8: Realistic round 2 with tool result ===");
  const tc7 = d7.toolCalls[0];
  const evs8 = await streaming([
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: "help me plan a dark mode feature in my app" },
    { role: "assistant", content: d7.rawText || null, tool_calls: d7.toolCalls },
    { role: "tool", tool_call_id: tc7.id, name: tc7.function.name, content: ".git\n.github/\nconfig/\nsrc/\npackage.json\ntsconfig.json" },
  ], tools, false);
  const d8 = describeEvents(evs8);
  console.log(`total=${d8.total} text_deltas=${d8.textDeltaCount} tool_deltas=${d8.toolDeltaCount} finish=${JSON.stringify(d8.finishReasons)}`);
  console.log("hasThink:", d8.hasThink, "more tool_calls:", d8.toolCalls.length > 0);
  console.log("rawText:", JSON.stringify(d8.rawText.slice(0, 400)));

  // Inspect ALL delta fields from the 60 mystery events
  console.log("\n--- Inspecting raw delta fields from TEST 8 events ---");
  const nonEmptyDeltas = evs8.filter((e: any) => {
    const d = e.choices?.[0]?.delta;
    if (!d) return false;
    return Object.keys(d).some(k => d[k] !== null && d[k] !== undefined && d[k] !== "");
  });
  console.log("events with non-empty delta:", nonEmptyDeltas.length);
  if (nonEmptyDeltas.length > 0) {
    // Show all unique delta keys
    const allKeys = new Set<string>();
    for (const e of evs8) {
      const d = (e as any).choices?.[0]?.delta;
      if (d) Object.keys(d).forEach(k => allKeys.add(k));
    }
    console.log("delta keys seen:", [...allKeys]);

    // Check for reasoning_content
    const reasoningEvs = evs8.filter((e: any) => e.choices?.[0]?.delta?.reasoning_content);
    console.log("events with reasoning_content:", reasoningEvs.length);
    if (reasoningEvs.length) {
      const reasoning = reasoningEvs.map((e: any) => e.choices[0].delta.reasoning_content).join("");
      console.log("reasoning_content (first 400):", reasoning.slice(0, 400));
    }

    // Show first 3 non-empty events
    for (const e of nonEmptyDeltas.slice(0, 3)) {
      console.log("sample event delta:", JSON.stringify((e as any).choices[0].delta));
    }
  }

  // Inspect ALL delta fields from the 60 mystery events
  console.log("\n--- Inspecting raw delta fields from TEST 8 events ---");
  const nonEmptyDeltas = evs8.filter((e: any) => {
    const d = e.choices?.[0]?.delta;
    if (!d) return false;
    return Object.keys(d).some(k => d[k] !== null && d[k] !== undefined && d[k] !== "");
  });
  console.log("events with non-empty delta:", nonEmptyDeltas.length);
  if (nonEmptyDeltas.length > 0) {
    // Show all unique delta keys
    const allKeys = new Set<string>();
    for (const e of evs8) {
      const d = (e as any).choices?.[0]?.delta;
      if (d) Object.keys(d).forEach(k => allKeys.add(k));
    }
    console.log("delta keys seen:", [...allKeys]);

    // Check for reasoning_content
    const reasoningEvs = evs8.filter((e: any) => e.choices?.[0]?.delta?.reasoning_content);
    console.log("events with reasoning_content:", reasoningEvs.length);
    if (reasoningEvs.length) {
      const reasoning = reasoningEvs.map((e: any) => e.choices[0].delta.reasoning_content).join("");
      console.log("reasoning_content (first 400):", reasoning.slice(0, 400));
    }

    // Show first 3 non-empty events
    for (const e of nonEmptyDeltas.slice(0, 3)) {
      console.log("sample event delta:", JSON.stringify((e as any).choices[0].delta));
    }
  }
}

