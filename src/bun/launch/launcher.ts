import { spawn } from "child_process";
import { detectTerminal, type DetectedTerminal } from "./terminal.ts";

function runOsascript(script: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn("osascript", ["-e", script], { stdio: ["ignore", "ignore", "pipe"] });
    let errOutput = "";
    proc.stderr?.on("data", (d: Buffer) => { errOutput += d.toString(); });
    proc.on("close", (code: number | null) => {
      if (code !== 0) reject(new Error(errOutput.trim() || `osascript exited with code ${code}`));
      else resolve();
    });
    proc.on("error", reject);
  });
}

async function launchMacOS(terminal: DetectedTerminal, command: string, cwd: string): Promise<void> {
  if (terminal.kind === "terminal-app") {
    const script = `tell application "Terminal" to do script "cd ${shellEscape(cwd)} && ${command}"`;
    await runOsascript(script);
    return;
  }

  if (terminal.kind === "iterm2") {
    // Create a new window if iTerm2 has none open; otherwise add a tab.
    const script = [
      `tell application "iTerm"`,
      `  activate`,
      `  if (count of windows) = 0 then`,
      `    create window with default profile`,
      `  else`,
      `    tell current window`,
      `      create tab with default profile`,
      `    end tell`,
      `  end if`,
      `  tell current window`,
      `    tell current session`,
      `      write text "cd ${shellEscape(cwd)} && ${command}"`,
      `    end tell`,
      `  end tell`,
      `end tell`,
    ].join("\n");
    await runOsascript(script);
    return;
  }

  // Warp, Ghostty, Kitty — open the app at cwd
  spawn("open", ["-a", terminal.path, cwd], { detached: true, stdio: "ignore" }).unref();
}

function launchWindows(terminal: DetectedTerminal, command: string, cwd: string): void {
  if (terminal.kind === "wt") {
    spawn("wt", ["-d", cwd, "cmd", "/k", command], { detached: true, stdio: "ignore" }).unref();
  } else {
    // cmd.exe fallback — use start to open a new window
    spawn("cmd.exe", ["/c", `start cmd.exe /k "cd /d "${cwd}" && ${command}"`], {
      detached: true,
      stdio: "ignore",
      shell: false,
    }).unref();
  }
}

function launchLinux(terminal: DetectedTerminal, command: string, cwd: string): void {
  let args: string[];

  switch (terminal.kind) {
    case "gnome-terminal":
      args = [`--working-directory=${cwd}`, "--", "bash", "-c", `${command}; exec bash`];
      break;
    case "konsole":
      args = ["--workdir", cwd, "-e", "bash", "-c", `${command}; exec bash`];
      break;
    case "xfce4-terminal":
      args = [`--working-directory=${cwd}`, "-e", `bash -c "${command}; exec bash"`];
      break;
    case "kitty-linux":
      args = ["--directory", cwd, "bash", "-c", `${command}; exec bash`];
      break;
    case "xterm":
    default:
      args = ["-e", `bash -c "cd ${shellEscape(cwd)} && ${command}; exec bash"`];
      break;
  }

  spawn(terminal.path, args, { detached: true, stdio: "ignore", cwd }).unref();
}

/**
 * Launch an app command silently at the given CWD (e.g. `code .`, `cursor .`).
 * Waits for the process to exit and throws if it fails (e.g. command not found).
 */
export function launchApp(command: string, cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn("sh", ["-c", command], {
      cwd,
      detached: true,
      stdio: ["ignore", "ignore", "pipe"],
    });
    let errOutput = "";
    proc.stderr?.on("data", (d: Buffer) => { errOutput += d.toString(); });
    proc.on("close", (code: number | null) => {
      if (code !== 0) reject(new Error(errOutput.trim() || `Command exited with code ${code}`));
      else resolve();
    });
    proc.on("error", reject);
    proc.unref();
  });
}

/** Simple shell escaping for single-quoted strings (replaces ' with '\''). */
function shellEscape(str: string): string {
  return str.replace(/'/g, "'\\''");
}

/**
 * Launch a command in an external terminal at the given CWD.
 * Throws if no terminal could be detected (Linux only case).
 */
export async function launchInTerminal(command: string, cwd: string): Promise<void> {
  const terminal = detectTerminal();
  if (!terminal) {
    throw new Error("No supported terminal emulator found on this system.");
  }

  const platform = process.platform;
  if (platform === "darwin") {
    await launchMacOS(terminal, command, cwd);
  } else if (platform === "win32") {
    launchWindows(terminal, command, cwd);
  } else {
    launchLinux(terminal, command, cwd);
  }
}
