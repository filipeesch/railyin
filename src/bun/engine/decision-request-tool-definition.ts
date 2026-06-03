import type { AIToolDefinition } from "../ai/types.ts";

export const DECISION_REQUEST_TOOL_DEFINITION: AIToolDefinition = {
    name: "decision_request",
    description:
        "Conduct a structured interview to gather direction on complex, high-stakes decisions.\n\n" +
        "ALWAYS use this tool — never plain prose — for architectural choices, technology selection, design tradeoffs, or any decision with non-trivial implications.\n\n" +
        "CRITICAL RULES:\n" +
        "- For 'exclusive' or 'non_exclusive' questions you MUST supply at least 2 entries in the 'options' array. NEVER embed choices or alternatives in the 'question' text — put them in 'options'.\n" +
        "- 'freetext' questions have no options — omit the 'options' field entirely.\n" +
        "- Batch all related decisions into one call.\n" +
        "- After the user submits answers, call record_decision (or update_decision if a record already exists) for EVERY question — never skip this step.\n\n" +
        "Writing effective questions:\n" +
        "- One focused decision per question. Use **bold** to highlight the key choice.\n" +
        "- Set 'weight' honestly: 'critical' (hard to undo), 'medium' (costly to undo), 'easy' (easily revisited).\n" +
        "- Set 'model_lean' to your recommended option title (must match exactly) and explain why in 'model_lean_reason'. Be transparent, not neutral.\n" +
        "- Set 'answers_affect_followup: true' when this answer should change subsequent questions.\n\n" +
        "Writing effective options (required for exclusive/non_exclusive):\n" +
        "- Each option needs a 'title' (2–5 words, scannable) and a 'description' (rich markdown: what this means in practice, pros/cons as bullet lists, when it's the right fit, what it forecloses — at least 3–5 sentences). Mermaid diagrams and ASCII Art are supported.\n" +
        "- Aim for 2–5 options per question. Quality beats quantity.\n" +
        "- An 'Other' option is added automatically by the UI — do not add it manually.",
    parameters: {
        type: "object",
        properties: {
            context: {
                type: "string",
                description: "Optional markdown preamble shown before the questions: why this decision is being made now, relevant constraints, and what has already been decided.",
            },
            questions: {
                type: "array",
                description: "One or more questions. Batch all related decisions into a single call.",
                minItems: 1,
                items: {
                    type: "object",
                    properties: {
                        question: { type: "string", description: "The question text as markdown. One focused decision per question; use **bold** to highlight the key choice. NEVER embed options or alternatives here — use the 'options' array." },
                        type: {
                            type: "string",
                            enum: ["exclusive", "non_exclusive", "freetext"],
                            description: "'exclusive': single choice from options. 'non_exclusive': user can pick several options. 'freetext': open-ended text answer, no options.",
                        },
                        weight: {
                            type: "string",
                            enum: ["critical", "medium", "easy"],
                            description: "Reversibility: 'critical' = hard to undo (e.g. DB schema), 'medium' = costly to undo, 'easy' = easily revisited.",
                        },
                        model_lean: {
                            type: "string",
                            description: "Title of your recommended option. Must match one of the option titles exactly.",
                        },
                        model_lean_reason: {
                            type: "string",
                            description: "One sentence explaining why you lean toward that option. Be specific (e.g. 'Already used throughout the codebase, no new dependency').",
                        },
                        answers_affect_followup: {
                            type: "boolean",
                            description: "Set true when the answer should shape what you ask or recommend next.",
                        },
                        options: {
                            type: "array",
                            description: "Required for 'exclusive' and 'non_exclusive' — must contain at least 2 entries. Each option needs a 'title' (2–5 words) and a 'description' (markdown: pros/cons, when it fits, what it forecloses — at least 3–5 sentences).",
                            minItems: 2,
                            items: {
                                type: "object",
                                properties: {
                                    title: { type: "string", description: "Short, scannable label (2–5 words, e.g. 'SQLite WAL', 'Redis Pub/Sub')." },
                                    description: { type: "string", description: "Rich markdown: what this choice means in practice, pros/cons (bullet lists), when it's the right fit, what it forecloses. At least 3–5 sentences. Mermaid diagrams and ASCII Art are supported." },
                                },
                                required: ["title", "description"],
                            },
                        },
                    },
                    required: ["question", "type"],
                },
            },
        },
        required: ["questions"],
    },
};
