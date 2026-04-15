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
