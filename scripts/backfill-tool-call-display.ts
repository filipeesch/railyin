import { getDb } from "../src/bun/db/index.ts";
import { canonicalToolDisplayLabel } from "../src/bun/engine/tool-display.ts";
import type { ToolCallDisplay } from "../src/shared/rpc-types.ts";

type ToolCallEnvelope = {
    type?: string;
    function?: {
        name?: string;
        arguments?: string | Record<string, unknown>;
    };
    display?: ToolCallDisplay;
    id?: string;
};

type ToolCallRow = {
    id: number;
    content: string;
};

function asObject(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown): string | undefined {
    if (value == null) return undefined;
    const text = String(value).trim();
    return text.length > 0 ? text : undefined;
}

function asPositiveNumber(value: unknown): number | undefined {
    const n = typeof value === "number" ? value : Number(value);
    return Number.isFinite(n) && n > 0 ? n : undefined;
}

function deriveCommonToolDisplay(name: string, args: Record<string, unknown>): ToolCallDisplay | null {
    switch (name) {
        case "get_task":
            return { label: "get task", subject: args.task_id != null ? `#${args.task_id}` : undefined };
        case "list_tasks":
            return { label: "list tasks", subject: asString(args.workflow_state ?? args.query) };
        case "get_board_summary":
            return { label: "board summary" };
        case "create_task":
            return { label: "create task", subject: asString(args.title) };
        case "edit_task":
            return { label: "edit task", subject: args.task_id != null ? `#${args.task_id}` : undefined };
        case "delete_task":
            return { label: "delete task", subject: args.task_id != null ? `#${args.task_id}` : undefined };
        case "move_task": {
            const id = args.task_id != null ? `#${args.task_id}` : undefined;
            const target = asString(args.workflow_state);
            return { label: "move task", subject: id && target ? `${id} → ${target}` : id ?? target };
        }
        case "message_task":
            return { label: "message task", subject: args.task_id != null ? `#${args.task_id}` : undefined };
        case "interview_me":
            return { label: "interview me" };
        default:
            return null;
    }
}

function deriveDisplay(name: string, args: Record<string, unknown>): ToolCallDisplay {
    const common = deriveCommonToolDisplay(name, args);
    if (common) return common;

    const label = canonicalToolDisplayLabel(name);
    const lowered = name.toLowerCase();
    const subject =
        asString(args.file_path) ??
        asString(args.path) ??
        asString(args.command) ??
        asString(args.pattern) ??
        asString(args.query) ??
        asString(args.url) ??
        asString(args.name) ??
        asString(args.title) ??
        (args.task_id != null ? `#${args.task_id}` : undefined);

    const display: ToolCallDisplay = { label, subject };

    if (["read", "read_file", "view", "write", "create", "write_file", "edit", "multiedit"].includes(lowered)) {
        display.contentType = "file";
    }
    if (["bash", "run", "run_in_terminal"].includes(lowered)) {
        display.contentType = "terminal";
    }

    const startLine = asPositiveNumber(args.startLine ?? args.start_line);
    if (startLine) display.startLine = startLine;

    return display;
}

function parseArgs(raw: unknown): Record<string, unknown> {
    if (typeof raw === "string") {
        try {
            return asObject(JSON.parse(raw));
        } catch {
            return {};
        }
    }
    return asObject(raw);
}

function needsUpdate(current: ToolCallDisplay | undefined, next: ToolCallDisplay): boolean {
    if (!current) return true;
    return current.label !== next.label
        || current.subject !== next.subject
        || current.contentType !== next.contentType
        || current.startLine !== next.startLine;
}

function main() {
    const apply = process.argv.includes("--apply");
    const db = getDb();
    const rows = db.query<ToolCallRow, []>(
        "SELECT id, content FROM conversation_messages WHERE type = 'tool_call' ORDER BY id ASC",
    ).all();

    let inspected = 0;
    let updated = 0;

    const updateStmt = db.prepare("UPDATE conversation_messages SET content = ? WHERE id = ?");

    for (const row of rows) {
        inspected += 1;
        let parsed: ToolCallEnvelope;
        try {
            parsed = JSON.parse(row.content) as ToolCallEnvelope;
        } catch {
            continue;
        }

        const name = parsed.function?.name;
        if (!name) continue;

        const args = parseArgs(parsed.function.arguments);
        const nextDisplay = deriveDisplay(name, args);
        if (!needsUpdate(parsed.display, nextDisplay)) continue;

        const nextPayload: ToolCallEnvelope = {
            ...parsed,
            display: nextDisplay,
        };

        updated += 1;
        if (apply) {
            updateStmt.run(JSON.stringify(nextPayload), row.id);
        }
    }

    const mode = apply ? "apply" : "dry-run";
    console.log(`[backfill-tool-call-display] mode=${mode} inspected=${inspected} updates=${updated}`);
    if (!apply) {
        console.log("Run with --apply to persist updates.");
    }
}

main();
