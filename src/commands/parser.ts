export type ToolName = "codex" | "claude";

export type ParsedCommand =
  | { kind: "start" }
  | { kind: "help" }
  | { kind: "doctor" }
  | { kind: "new"; tool: ToolName; cwd: string | null }
  | { kind: "sessions" }
  | { kind: "switch"; id: string }
  | { kind: "resume"; id: string }
  | { kind: "fork"; id: string }
  | { kind: "stop" }
  | { kind: "status" }
  | { kind: "keyboard" }
  | { kind: "raw"; text: string }
  | { kind: "send"; text: string }
  | { kind: "cwd"; value: string | null }
  | { kind: "files" }
  | { kind: "forward"; text: string }
  | { kind: "invalid"; reason: string };

type ParsedInput = {
  command: string;
  args: string | null;
};

const NO_ARG_COMMANDS = new Map<string, ParsedCommand>([
  ["/start", { kind: "start" }],
  ["/help", { kind: "help" }],
  ["/doctor", { kind: "doctor" }],
  ["/sessions", { kind: "sessions" }],
  ["/stop", { kind: "stop" }],
  ["/status", { kind: "status" }],
  ["/keyboard", { kind: "keyboard" }],
  ["/files", { kind: "files" }],
]);

export function parseCommand(input: string): ParsedCommand {
  if (!input.startsWith("/")) {
    return { kind: "forward", text: input };
  }

  const parsed = splitCommand(input);
  if (parsed === null) {
    return { kind: "forward", text: input };
  }

  const noArgCommand = NO_ARG_COMMANDS.get(parsed.command);
  if (noArgCommand !== undefined) {
    if (parsed.args !== null && parsed.args.trim() !== "") {
      return { kind: "invalid", reason: `Usage: ${parsed.command}` };
    }
    return noArgCommand;
  }

  switch (parsed.command) {
    case "/new":
      return parseNewCommand(parsed.args);
    case "/switch":
      return parseIdCommand("switch", parsed.args);
    case "/resume":
      return parseIdCommand("resume", parsed.args);
    case "/fork":
      return parseIdCommand("fork", parsed.args);
    case "/raw":
      return parseTextCommand("raw", parsed.args);
    case "/send":
      return parseTextCommand("send", parsed.args);
    case "/cwd":
      return parseCwdCommand(parsed.args);
    default:
      return { kind: "invalid", reason: `Unknown command: ${parsed.command}` };
  }
}

function splitCommand(input: string): ParsedInput | null {
  const match = input.match(/^(\/\S+)(?:\s([\s\S]*))?$/);
  if (match === null || match[1] === undefined) {
    return null;
  }

  return {
    command: match[1],
    args: match[2] ?? null,
  };
}

function parseNewCommand(args: string | null): ParsedCommand {
  const trimmed = args?.trim() ?? "";
  if (trimmed === "") {
    return { kind: "invalid", reason: "Usage: /new codex|claude [cwd]" };
  }

  const [tool, ...cwdParts] = trimmed.split(/\s+/);
  if (tool !== "codex" && tool !== "claude") {
    return { kind: "invalid", reason: "Usage: /new codex|claude [cwd]" };
  }

  const cwd = cwdParts.length === 0 ? null : cwdParts.join(" ");
  return { kind: "new", tool, cwd };
}

function parseIdCommand(kind: "switch" | "resume" | "fork", args: string | null): ParsedCommand {
  const trimmed = args?.trim() ?? "";
  if (trimmed === "" || /\s/.test(trimmed)) {
    return { kind: "invalid", reason: `Usage: /${kind} <id>` };
  }

  return { kind, id: trimmed };
}

function parseTextCommand(kind: "raw" | "send", args: string | null): ParsedCommand {
  if (args === null || args === "") {
    return { kind: "invalid", reason: `Usage: /${kind} <text>` };
  }

  return { kind, text: args };
}

function parseCwdCommand(args: string | null): ParsedCommand {
  const trimmed = args?.trim() ?? "";
  return { kind: "cwd", value: trimmed === "" ? null : trimmed };
}
