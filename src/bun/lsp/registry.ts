// ─── LSP Language Registry ────────────────────────────────────────────────────
// Each entry describes a language: how to detect it, which server handles it,
// and how to install that server on each supported platform.

export type Platform = "macos" | "linux" | "windows" | "*";

export interface InstallOption {
  /** Human-readable label shown in the setup prompt. */
  label: string;
  /** Shell command to run (executed via login shell). */
  command: string;
  /** Platforms this option applies to. "*" = all. */
  platforms: Platform[];
}

export interface LanguageEntry {
  /** Display name shown in the UI. */
  name: string;
  /** File names / glob patterns checked at project root (depth 1). */
  detectionGlobs: string[];
  /** Binary name used for PATH probing and workspace.yaml. */
  serverName: string;
  /** File extensions routed to this server in workspace.yaml. */
  extensions: string[];
  /** Ordered install options (preferred first). Platform-filtered at runtime. */
  installOptions: InstallOption[];
}

// ─── Registry ─────────────────────────────────────────────────────────────────

export const LANGUAGE_REGISTRY: LanguageEntry[] = [
  {
    name: "TypeScript / JavaScript",
    detectionGlobs: ["tsconfig.json", "tsconfig.*.json", "package.json", "*.ts", "*.tsx", "*.js", "*.jsx"],
    serverName: "typescript-language-server",
    extensions: [".ts", ".tsx", ".js", ".jsx"],
    installOptions: [
      {
        label: "npm (global)",
        command: "npm install -g typescript typescript-language-server",
        platforms: ["*"],
      },
      {
        label: "Homebrew",
        command: "brew install typescript-language-server",
        platforms: ["macos"],
      },
    ],
  },
  {
    name: "Python",
    detectionGlobs: ["pyproject.toml", "setup.py", "setup.cfg", "requirements.txt", "*.py"],
    serverName: "pyright-langserver",
    extensions: [".py"],
    installOptions: [
      {
        label: "npm (global)",
        command: "npm install -g pyright",
        platforms: ["*"],
      },
      {
        label: "pip",
        command: "pip install pyright",
        platforms: ["*"],
      },
    ],
  },
  {
    name: "Rust",
    detectionGlobs: ["Cargo.toml"],
    serverName: "rust-analyzer",
    extensions: [".rs"],
    installOptions: [
      {
        label: "rustup",
        command: "rustup component add rust-analyzer",
        platforms: ["*"],
      },
      {
        label: "Homebrew",
        command: "brew install rust-analyzer",
        platforms: ["macos"],
      },
    ],
  },
  {
    name: "Go",
    detectionGlobs: ["go.mod"],
    serverName: "gopls",
    extensions: [".go"],
    installOptions: [
      {
        label: "go install",
        command: "go install golang.org/x/tools/gopls@latest",
        platforms: ["*"],
      },
      {
        label: "Homebrew",
        command: "brew install gopls",
        platforms: ["macos"],
      },
    ],
  },
  {
    name: "Ruby",
    detectionGlobs: ["Gemfile", "*.gemspec", ".ruby-version"],
    serverName: "solargraph",
    extensions: [".rb"],
    installOptions: [
      {
        label: "gem",
        command: "gem install solargraph",
        platforms: ["*"],
      },
      {
        label: "Homebrew",
        command: "brew install solargraph",
        platforms: ["macos"],
      },
    ],
  },
];

// ─── Platform helper ──────────────────────────────────────────────────────────

/**
 * Returns a copy of the registry with installOptions filtered to those that
 * apply on the given platform. Entries with no remaining options are kept
 * (they can still be detected and probed — just no install shortcut).
 */
export function getRegistryForPlatform(platform: NodeJS.Platform): LanguageEntry[] {
  const normalized: Platform =
    platform === "darwin" ? "macos" :
    platform === "win32"  ? "windows" :
    platform === "linux"  ? "linux" :
    "linux"; // fallback for other POSIX

  return LANGUAGE_REGISTRY.map((entry) => ({
    ...entry,
    installOptions: entry.installOptions.filter(
      (opt) => opt.platforms.includes("*") || opt.platforms.includes(normalized),
    ),
  }));
}
