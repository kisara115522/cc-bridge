import os from "node:os";

import { spawn as nodePtySpawn } from "node-pty";

export type ToolName = "codex" | "claude";

export interface RunnerStartRequest {
  readonly sessionId: string;
  readonly tool: ToolName;
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env: Record<string, string | undefined>;
  readonly cols?: number;
  readonly rows?: number;
  readonly onEvent: (event: RunnerEvent) => void;
}

export type RunnerEvent =
  | {
      readonly kind: "started";
      readonly sessionId: string;
      readonly pid: number;
    }
  | {
      readonly kind: "output";
      readonly sessionId: string;
      readonly data: string;
    }
  | {
      readonly kind: "exit";
      readonly sessionId: string;
      readonly exitCode: number;
      readonly signal?: number;
    }
  | {
      readonly kind: "error";
      readonly sessionId: string;
      readonly message: string;
    };

export interface RunnerHandle {
  readonly sessionId: string;
  readonly tool: ToolName;
  readonly pid: number;
  write(data: string): void;
  interrupt(): void;
  terminate(signal?: string): void;
}

export interface ToolRunner {
  start(request: RunnerStartRequest): Promise<RunnerHandle>;
}

export interface PtyProcess {
  readonly pid: number;
  onData(handler: (data: string) => void): void;
  onExit(handler: (event: { exitCode: number; signal?: number }) => void): void;
  write(data: string): void;
  kill(signal?: string): void;
}

export type SpawnPty = (
  file: string,
  args: string[],
  options: {
    cwd: string;
    env: Record<string, string>;
    cols: number;
    rows: number;
    name: string;
  }
) => PtyProcess;

export interface PtyRunnerOptions {
  readonly spawn?: SpawnPty;
}

const defaultCols = 100;
const defaultRows = 30;

export function createPtyRunner(options: PtyRunnerOptions = {}): ToolRunner {
  const spawn = options.spawn ?? spawnNodePty;

  return {
    async start(request) {
      try {
        const pty = spawn(request.command, [...request.args], {
          cwd: request.cwd,
          env: normalizeEnv(request.env),
          cols: request.cols ?? defaultCols,
          rows: request.rows ?? defaultRows,
          name: "xterm-256color"
        });

        pty.onData((data) => {
          request.onEvent({ kind: "output", sessionId: request.sessionId, data });
        });

        pty.onExit((event) => {
          request.onEvent({
            kind: "exit",
            sessionId: request.sessionId,
            exitCode: event.exitCode,
            signal: event.signal
          });
        });

        request.onEvent({
          kind: "started",
          sessionId: request.sessionId,
          pid: pty.pid
        });

        return {
          sessionId: request.sessionId,
          tool: request.tool,
          pid: pty.pid,
          write(data: string) {
            pty.write(data);
          },
          interrupt() {
            pty.write("\x03");
          },
          terminate(signal?: string) {
            pty.kill(signal);
          }
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        request.onEvent({ kind: "error", sessionId: request.sessionId, message });
        throw error;
      }
    }
  };
}

function spawnNodePty(
  file: string,
  args: string[],
  options: {
    cwd: string;
    env: Record<string, string>;
    cols: number;
    rows: number;
    name: string;
  }
): PtyProcess {
  return nodePtySpawn(file, args, options);
}

function normalizeEnv(env: Record<string, string | undefined>): Record<string, string> {
  const merged: Record<string, string | undefined> = {
    ...process.env,
    SHELL: process.env.SHELL ?? "/bin/zsh",
    TERM: process.env.TERM ?? "xterm-256color",
    HOME: process.env.HOME ?? os.homedir(),
    ...env
  };

  return Object.fromEntries(
    Object.entries(merged).filter((entry): entry is [string, string] => entry[1] !== undefined)
  );
}
