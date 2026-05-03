import { describe, expect, it } from "vitest";

import { createPtyRunner, type PtyProcess, type SpawnPty } from "../src/runner/ptyRunner.js";

class FakePty implements PtyProcess {
  readonly pid = 1234;
  readonly writes: string[] = [];
  readonly kills: string[] = [];
  private dataHandler: ((data: string) => void) | null = null;
  private exitHandler: ((event: { exitCode: number; signal?: number }) => void) | null = null;

  onData(handler: (data: string) => void): void {
    this.dataHandler = handler;
  }

  onExit(handler: (event: { exitCode: number; signal?: number }) => void): void {
    this.exitHandler = handler;
  }

  write(data: string): void {
    this.writes.push(data);
  }

  kill(signal?: string): void {
    this.kills.push(signal ?? "SIGTERM");
  }

  emitData(data: string): void {
    this.dataHandler?.(data);
  }

  emitExit(exitCode: number, signal?: number): void {
    this.exitHandler?.({ exitCode, signal });
  }
}

describe("createPtyRunner", () => {
  it("spawns a PTY process and emits output and exit events", async () => {
    const fake = new FakePty();
    const events: unknown[] = [];
    const spawn: SpawnPty = (file, args, options) => {
      expect(file).toBe("/bin/echo");
      expect(args).toEqual(["hello"]);
      expect(options.cwd).toBe("/tmp/project");
      expect(options.cols).toBe(120);
      expect(options.rows).toBe(40);
      return fake;
    };

    const runner = createPtyRunner({ spawn });
    const handle = await runner.start({
      sessionId: "bridge_1",
      tool: "codex",
      command: "/bin/echo",
      args: ["hello"],
      cwd: "/tmp/project",
      env: { PATH: "/bin" },
      cols: 120,
      rows: 40,
      onEvent: (event) => events.push(event)
    });

    expect(handle.pid).toBe(1234);

    fake.emitData("ready");
    fake.emitExit(0);

    expect(events).toEqual([
      { kind: "started", sessionId: "bridge_1", pid: 1234 },
      { kind: "output", sessionId: "bridge_1", data: "ready" },
      { kind: "exit", sessionId: "bridge_1", exitCode: 0, signal: undefined }
    ]);
  });

  it("writes input and sends ctrl-c before terminating", async () => {
    const fake = new FakePty();
    const runner = createPtyRunner({ spawn: () => fake });
    const handle = await runner.start({
      sessionId: "bridge_1",
      tool: "claude",
      command: "/bin/cat",
      args: [],
      cwd: "/tmp/project",
      env: {},
      onEvent: () => {}
    });

    handle.write("hello\r");
    handle.interrupt();
    handle.terminate("SIGKILL");

    expect(fake.writes).toEqual(["hello\r", "\x03"]);
    expect(fake.kills).toEqual(["SIGKILL"]);
  });
});
