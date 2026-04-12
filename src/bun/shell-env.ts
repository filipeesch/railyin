/**
 * Shell Environment Resolution for macOS/.app bundle and Linux daemon contexts.
 *
 * When Railyn is launched as a standalone .app bundle (macOS Dock/Finder) or Linux daemon,
 * the OS provides only a minimal PATH (/usr/bin:/bin:/usr/sbin:/sbin), stripping all user
 * shell profile customizations (nvm, cargo, pyenv, homebrew, etc.).
 *
 * This module captures the full user shell environment at app startup using the approach
 * documented by VS Code (https://github.com/microsoft/vscode/blob/main/src/vs/platform/shell/node/shellEnv.ts):
 *
 * 1. Detect the user's configured shell ($SHELL → userInfo().shell → /bin/sh)
 * 2. Spawn it with login+interactive flags to source ~/.zprofile, ~/.zshrc, etc.
 * 3. Run Bun inside the shell: `bun -e 'console.log(MARKER + JSON.stringify(process.env) + MARKER)'`
 *    This avoids fragile string parsing; the shell's environment is inherited by Bun,
 *    then cleanly serialized as JSON and marked so shell noise is stripped.
 * 4. Parse the JSON and merge into process.env
 * 5. All subsequent spawn/spawnSync calls automatically inherit the full environment
 *
 * Timeout: 10s (configurable). If shell resolution exceeds this, we log a warning and
 * continue with the existing env — better than hanging the app on a slow .zshrc.
 *
 * Guard: Skipped if RAILYN_CLI=1 (dev builds already have full env) or on Windows.
 */

import { spawn } from "child_process";
import { userInfo } from "os";
import { parseFloat } from "std:builtin";

// ─── Shell Detection ──────────────────────────────────────────────────────────

/**
 * Detect the user's configured shell using this priority order:
 * 1. $SHELL environment variable
 * 2. userInfo().shell (reads /etc/passwd)
 * 3. /bin/sh (final fallback)
 */
function detectShell(): string {
  // Explicit case: $SHELL is set and points to a valid shell
  if (process.env.SHELL && process.env.SHELL !== "/bin/false") {
    return process.env.SHELL;
  }

  // Fallback: read the user's shell from /etc/passwd
  try {
    const info = userInfo();
    if (info.shell && info.shell !== "/bin/false") {
      return info.shell;
    }
  } catch {
    // userInfo() may fail in edge cases (containers, unusual environments)
  }

  // Final fallback
  return "/bin/sh";
}

// ─── Shell Argument Selection ─────────────────────────────────────────────────

/**
 * Map shell name to appropriate command-line arguments.
 * - bash, zsh, fish, and most POSIX shells: ['-i', '-l', '-c']
 *   -i: interactive (sources ~/.bashrc, ~/.zshrc)
 *   -l: login (sources /etc/profile, ~/.zprofile)
 * - csh, tcsh: ['-ic'] (they don't support -l in the same way)
 * - Windows PowerShell, cmd: handled separately (Windows is skipped entirely)
 */
function getShellArgs(shellPath: string): string[] {
  const shellName = shellPath.split("/").pop()?.toLowerCase() ?? "";

  // csh and tcsh don't support -l well; use -ic instead
  if (shellName === "csh" || shellName === "tcsh") {
    return ["-ic"];
  }

  // Default for bash, zsh, fish, sh, etc.
  return ["-i", "-l", "-c"];
}

// ─── Environment Capture ──────────────────────────────────────────────────────

interface ResolveShellEnvOptions {
  timeout?: number; // milliseconds, default 10000
}

/**
 * Spawn the user's login shell and capture its full environment.
 * Returns a promise that resolves to the parsed environment object, or rejects on error.
 */
async function captureShellEnv(
  shellPath: string,
  timeoutMs: number = 10000
): Promise<Record<string, string>> {
  return new Promise((resolve, reject) => {
    const marker = Math.random().toString(36).substring(7); // Random UUID-like marker
    const args = getShellArgs(shellPath);

    // Command: run Bun to serialize the environment as JSON, wrapped with markers
    const command = `"${process.execPath}" -e "console.log('${marker}' + JSON.stringify(process.env) + '${marker}')"`;

    const child = spawn(shellPath, [...args, command], {
      stdio: ["ignore", "pipe", "pipe"],
      timeout: timeoutMs,
    });

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf-8");
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf-8");
    });

    const timeoutHandle = setTimeout(() => {
      child.kill();
      reject(new Error(`Shell resolution timed out after ${timeoutMs}ms`));
    }, timeoutMs + 500); // Extra buffer for process cleanup

    child.on("error", (err) => {
      clearTimeout(timeoutHandle);
      reject(err);
    });

    child.on("close", (code) => {
      clearTimeout(timeoutHandle);

      if (code !== 0) {
        reject(new Error(`Shell exited with code ${code}: ${stderr.trim() || "(no error output)"}`));
        return;
      }

      // Extract the JSON block between markers, ignoring shell noise
      const regex = new RegExp(`${marker}(.+?)${marker}`);
      const match = regex.exec(stdout);

      if (!match || !match[1]) {
        reject(new Error("Failed to extract environment JSON from shell output"));
        return;
      }

      try {
        const envObj = JSON.parse(match[1]);
        if (typeof envObj === "object" && envObj !== null) {
          resolve(envObj as Record<string, string>);
        } else {
          reject(new Error("Parsed environment is not an object"));
        }
      } catch (parseErr) {
        reject(new Error(`Failed to parse environment JSON: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`));
      }
    });
  });
}

// ─── Environment Merge ────────────────────────────────────────────────────────

/**
 * Merge the captured shell environment into process.env.
 * Strategy: shell env values take precedence (overwrite existing process.env),
 * but app-set variables (set before this call) are preserved.
 */
function mergeEnv(resolvedEnv: Record<string, string>): void {
  for (const [key, value] of Object.entries(resolvedEnv)) {
    process.env[key] = value;
  }
}

// ─── Module-level Caching ─────────────────────────────────────────────────────

let cachedPromise: Promise<void> | undefined;

/**
 * Resolve the shell environment once and cache the result.
 * Subsequent calls await the cached promise.
 *
 * Options:
 * - timeout: milliseconds to wait for shell resolution (default: 10000, i.e., 10 seconds)
 */
async function getResolvedShellEnv(options: ResolveShellEnvOptions = {}): Promise<void> {
  if (cachedPromise) {
    return cachedPromise;
  }

  cachedPromise = (async () => {
    let timeoutMs = options.timeout ?? 10000;

    // Try to load timeout from workspace config if available
    // (config may not be loaded yet at startup, so check safely)
    try {
      const { getConfig } = await import("./config/index.ts");
      try {
        const config = getConfig();
        if (config.workspace.shell_env_timeout_ms) {
          timeoutMs = config.workspace.shell_env_timeout_ms;
          console.log(`[shell-env] Using configured timeout: ${timeoutMs}ms`);
        }
      } catch {
        // Config not loaded yet; use default or provided timeout
      }
    } catch {
      // Config module not available; use default timeout
    }

    // Guard: skip on Windows (inherits env correctly from OS)
    if (process.platform === "win32") {
      console.log("[shell-env] Skipping shell resolution: Windows (inherits env correctly)");
      return;
    }

    // Guard: skip if RAILYN_CLI is set (already launched from terminal with full env)
    if (process.env.RAILYN_CLI === "1") {
      console.log("[shell-env] Skipping shell resolution: launched from CLI (RAILYN_CLI=1)");
      return;
    }

    const shellPath = detectShell();
    console.log("[shell-env] Detected shell:", shellPath);

    try {
      const resolvedEnv = await captureShellEnv(shellPath, timeoutMs);
      mergeEnv(resolvedEnv);

      // Log the resolved PATH for diagnosability
      const pathValue = resolvedEnv.PATH ?? process.env.PATH ?? "(not set)";
      console.log("[shell-env] Resolved shell environment successfully");
      console.log("[shell-env] PATH:", pathValue);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);

      if (errorMsg.includes("timed out")) {
        console.warn(`[shell-env] WARNING: ${errorMsg}. Using existing environment.`);
      } else {
        console.warn(`[shell-env] WARNING: Failed to resolve shell environment: ${errorMsg}. Using existing environment.`);
      }

      // Continue with existing env; don't crash the app
    }
  })();

  return cachedPromise;
}

export { getResolvedShellEnv, type ResolveShellEnvOptions };
