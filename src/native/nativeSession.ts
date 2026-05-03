export type NativeTool = "codex" | "claude";
export type NativeSessionConfidence = "explicit" | "discovered" | "unknown";

export type NativeSessionRef =
  | {
      tool: "claude";
      confidence: "explicit";
      sessionId: string;
    }
  | {
      tool: "codex";
      confidence: "discovered";
      sessionId: string;
    }
  | {
      tool: "codex";
      confidence: "unknown";
      sessionId?: undefined;
    };

export interface BuildNativeSessionCommandOptions {
  tool: NativeTool;
  action: "new" | "resume" | "fork";
  command: string;
  baseArgs: string[];
  cwd: string;
  sessionId?: string;
}

export interface NativeSessionCommand {
  command: string;
  args: string[];
  cwd: string;
}

export function buildNativeSessionCommand(
  options: BuildNativeSessionCommandOptions
): NativeSessionCommand {
  const args =
    options.tool === "claude" ? buildClaudeArgs(options) : buildCodexArgs(options);

  return {
    command: options.command,
    args,
    cwd: options.cwd
  };
}

function buildClaudeArgs(options: BuildNativeSessionCommandOptions): string[] {
  const sessionId = requireSessionId(options);

  if (options.action === "new") {
    return [...options.baseArgs, "--session-id", sessionId];
  }

  if (options.action === "resume") {
    return [...options.baseArgs, "--resume", sessionId];
  }

  return [...options.baseArgs, "--resume", sessionId, "--fork-session"];
}

function buildCodexArgs(options: BuildNativeSessionCommandOptions): string[] {
  const commonArgs = withCodexSessionFlags(options.baseArgs, options.cwd);

  if (options.action === "new") {
    return commonArgs;
  }

  return [options.action, requireSessionId(options), ...commonArgs];
}

function withCodexSessionFlags(baseArgs: string[], cwd: string): string[] {
  const args = baseArgs.filter((arg) => arg !== "--no-alt-screen");

  if (!hasOption(args, "--cd")) {
    args.push("--cd", cwd);
  }

  args.push("--no-alt-screen");

  return args;
}

function hasOption(args: string[], option: string): boolean {
  return args.includes(option) || args.some((arg) => arg.startsWith(`${option}=`));
}

function requireSessionId(options: BuildNativeSessionCommandOptions): string {
  if (!options.sessionId) {
    throw new Error(`${options.tool} ${options.action} requires a native session id`);
  }

  return options.sessionId;
}
