import type { AIToolDefinition } from "../ai/types.ts";

export const INTERVIEW_ME_TOOL_DEFINITION: AIToolDefinition = {
    name: "interview_me",
    description:
        "Conduct a structured interview to gather direction on complex, high-stakes decisions.\n\n" +
        "ALWAYS use this tool - never plain prose - when the conversation requires architectural choices, technology selection, design tradeoffs, ASCII Art and layout options, or any decision where the implications are non-trivial and the user needs to understand what they are committing to.\n\n" +
        "How to write great questions:\n" +
        "- Ask one clear, focused question per item. Avoid compound questions.\n" +
        "- The 'question' field is rendered as markdown — write multiple lines if the decision needs context, and use **bold** to highlight the key decision point.\n" +
        "- Set 'weight' honestly: 'critical' = hard to change later (data model, engine choice), 'medium' = requires effort to change, 'easy' = easily revisited.\n" +
        "- Set 'model_lean' to your recommended option title and explain WHY in 'model_lean_reason'. Be transparent, not neutral.\n" +
        "- Set 'answers_affect_followup: true' when the answer to this question should change what you ask next.\n\n" +
        "How to write great options:\n" +
        "- Every option MUST have a 'title' (short, scannable) and a 'description' (rich markdown).\n" +
        "- The 'description' is the most important field. It's markdown rendered so you can show rich content, mermaid diagrams are supported and use ASCII Art for UX/UI illustrations. It should explain: what this choice means in practice, its concrete pros and cons, when it's the right fit, and what it forecloses. Write at least 3-5 sentences. Use bullet lists for pros/cons.\n" +
        "- Always include an 'Other' option implicitly - the UI adds it automatically.\n" +
        "- Avoid listing more than 4-5 options. Fewer, well-explained options beat a long list.\n\n" +
        "Use 'context' to set the stage. Write it as structured markdown — use paragraphs and bullet lists. Explain why this decision is being made now, what constraints exist, what has already been decided.\n\n" +
        "Use 'non_exclusive' when the user can reasonably combine multiple options (e.g. testing strategies, feature flags). Use 'exclusive' when options are mutually incompatible.\n\n" +
        "Use 'freetext' for open-ended questions where no preset options make sense - e.g. 'Any additional constraints?' or 'What is your target timeline?'.\n\n" +
        "ALWAYS batch all related decisions into one call. If more clarification is needed you can call interview_me again with follow-up questions in batch.",
    parameters: {
        type: "object",
        properties: {
            context: {
                type: "string",
                description: "Write as structured markdown, rendered directly to the user. Use paragraphs, bullet lists, or headings to set the stage: why this decision is being made now, relevant constraints, and what has already been decided.",
            },
            questions: {
                type: "array",
                description: "One or more questions. Batch all related decisions into a single call - do not call interview_me multiple times in sequence.",
                minItems: 1,
                items: {
                    type: "object",
                    properties: {
                        question: { type: "string", description: "The question text. Be specific and focused — one decision per question. Write as markdown rendered directly to the user; use **bold** to highlight the key decision point. Use multiple paragraphs if the question needs context." },
                        type: {
                            type: "string",
                            enum: ["exclusive", "non_exclusive", "freetext"],
                            description: "'exclusive' for mutually exclusive single choice. 'non_exclusive' for multi-select (user can pick several). 'freetext' for open-ended input with no preset options.",
                        },
                        weight: {
                            type: "string",
                            enum: ["critical", "medium", "easy"],
                            description: "Reversibility signal. 'critical' = foundational, hard to change (e.g. DB schema, engine choice). 'medium' = changeable but requires significant effort. 'easy' = easily revisited.",
                        },
                        model_lean: {
                            type: "string",
                            description: "The exact title of the option you recommend. Must match one of the option titles exactly. Be transparent - do not leave blank if you have a clear preference.",
                        },
                        model_lean_reason: {
                            type: "string",
                            description: "One sentence explaining WHY you lean toward that option. Be specific, not generic (e.g. 'Already used throughout the codebase, no new dependency' not 'It is a good fit').",
                        },
                        answers_affect_followup: {
                            type: "boolean",
                            description: "Set true when the answer to this question should shape what you ask or recommend next.",
                        },
                        options: {
                            type: "array",
                            description: "Options to present. Required for 'exclusive' and 'non_exclusive'. Aim for 2-5 options. Quality over quantity - fewer, well-explained options are better.",
                            items: {
                                type: "object",
                                properties: {
                                    title: { type: "string", description: "Short, scannable option title (e.g. 'SQLite WAL', 'Redis Pub/Sub'). 2-5 words." },
                                    description: { type: "string", description: "THE KEY FIELD. Rich markdown explaining: what this choice means in practice, concrete pros and cons (use bullet lists), when it is the right fit, what it forecloses or makes harder. Write at least 3-5 substantive sentences, mermaid diagrams supported, use ASCII Art to illustrate UX/UI. The user will read this to understand what they are committing to." },
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
