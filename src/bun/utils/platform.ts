import { homedir, tmpdir } from "node:os";
import { delimiter, join } from "node:path";

export function isWindows(): boolean {
  return process.platform === "win32";
}

export function getHomeDir(): string {
  return homedir();
}

export function getTmpDir(): string {
  return tmpdir();
}

export function getDataDir(): string {
  return process.env.RAILYN_DATA_DIR ?? join(homedir(), ".railyn");
}

export function getPathDelimiter(): string {
  return delimiter;
}

export function getDefaultShell(): string {
  if (process.env.SHELL) return process.env.SHELL;
  if (isWindows()) return process.env.COMSPEC ?? "cmd.exe";
  return "/bin/sh";
}

export function getShellArgs(cmd: string): string[] {
  return isWindows() ? ["/c", cmd] : ["-c", cmd];
}

export function getGitFallbacks(): string[] {
  return isWindows()
    ? [
        "C:\\Program Files\\Git\\bin\\git.exe",
        "C:\\Program Files (x86)\\Git\\bin\\git.exe",
        "C:\\Program Files\\Git\\cmd\\git.exe",
      ]
    : ["/usr/bin/git", "/usr/local/bin/git", "/opt/homebrew/bin/git"];
}
