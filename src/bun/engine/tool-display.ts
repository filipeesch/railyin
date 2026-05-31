export function stripRailyinMcpPrefix(name: string): string {
    const PREFIX = "mcp__railyin__";
    return name.startsWith(PREFIX) ? name.slice(PREFIX.length) : name;
}

export function humanizeToolName(name: string): string {
    const withoutMcp = name.startsWith("mcp__") ? name.slice("mcp__".length) : name;
    return withoutMcp.replace(/__/g, " ").replace(/_/g, " ");
}

export function stripWorktreePath(subject: string | undefined, worktreePath?: string): string | undefined {
    if (!subject || !worktreePath) return subject;
    const prefix = worktreePath.endsWith("/") ? worktreePath : worktreePath + "/";
    if (subject.startsWith(prefix)) return subject.slice(prefix.length);
    if (subject.startsWith(worktreePath)) return subject.slice(worktreePath.length).replace(/^\//, "");
    return subject;
}

export function canonicalToolDisplayLabel(name: string): string {
    switch (name.toLowerCase()) {
        case "read":
        case "read_file":
        case "view":
            return "read";
        case "write":
        case "create":
        case "write_file":
            return "write";
        case "edit":
        case "multiedit":
            return "edit";
        case "bash":
        case "run":
        case "run_in_terminal":
            return "run";
        case "grep":
        case "rg":
        case "grep_search":
            return "search";
        case "find":
        case "find_files":
        case "glob":
            return "find";
        case "ls":
            return "list";
        case "webfetch":
        case "web_fetch":
            return "fetch";
        case "apply_patch":
            return "patch";
        case "delete_file":
        case "delete":
            return "delete";
        case "rename_file":
        case "rename":
            return "rename";
        case "task":
            return "task";
        case "skill":
            return "skill";
        case "store_memory":
            return "store memory";
        case "todowrite":
            return "todo";
        default:
            return name;
    }
}
