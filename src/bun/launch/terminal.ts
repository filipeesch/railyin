import { existsSync } from "fs";
import { spawnSync } from "child_process";

export type TerminalKind =
  | "iterm2"
  | "warp"
  | "ghostty"
  | "kitty"
  | "terminal-app"
  | "wt"
  | "cmd"
  | "gnome-terminal"
  | "konsole"
  | "xfce4-terminal"
  | "kitty-linux"
  | "xterm";

export interface DetectedTerminal {
  kind: TerminalKind;
  /** Executable path or app name, depending on OS */
  path: string;
}

// Session-level cache
let cached: DetectedTerminal | null | undefined = undefined;

function commandExists(cmd: string): boolean {
  try {
    const result = spawnSync("which", [cmd], { encoding: "utf-8" });
    return result.status === 0 && result.stdout.trim().length > 0;
  } catch {
    return false;
  }
}

function appExists(appName: string): boolean {
  return (
    existsSync(`/Applications/${appName}.app`) ||
    existsSync(`${process.env.HOME}/Applications/${appName}.app`)
  );
}

function detectMacOS(): DetectedTerminal {
  if (appExists("iTerm")) return { kind: "iterm2", path: "iTerm" };
  if (appExists("Warp")) return { kind: "warp", path: "Warp" };
  if (appExists("Ghostty")) return { kind: "ghostty", path: "Ghostty" };
  if (appExists("kitty")) return { kind: "kitty", path: "kitty" };
  // Terminal.app is always available on macOS
  return { kind: "terminal-app", path: "Terminal" };
}

function detectWindows(): DetectedTerminal {
  if (commandExists("wt")) return { kind: "wt", path: "wt" };
  return { kind: "cmd", path: "cmd.exe" };
}

function detectLinux(): DetectedTerminal | null {
  const candidates: Array<[string, TerminalKind]> = [
    ["gnome-terminal", "gnome-terminal"],
    ["konsole", "konsole"],
    ["xfce4-terminal", "xfce4-terminal"],
    ["kitty", "kitty-linux"],
    ["xterm", "xterm"],
  ];
  for (const [cmd, kind] of candidates) {
    if (commandExists(cmd)) return { kind, path: cmd };
  }
  return null;
}

/** Detect the best available terminal emulator for the current OS. Result is cached for the session. */
export function detectTerminal(): DetectedTerminal | null {
  if (cached !== undefined) return cached;

  const platform = process.platform;
  if (platform === "darwin") {
    cached = detectMacOS();
  } else if (platform === "win32") {
    cached = detectWindows();
  } else {
    cached = detectLinux();
  }

  return cached ?? null;
}
