import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createBridgeApp } from "../src/app/bridgeApp.js";
import type {
  ChannelAdapter,
  ChannelHandlers,
  ChannelInteraction,
  InboundMessage,
  OutboundMessage,
  SentMessageRef
} from "../src/channel/types.js";
import { loadConfig } from "../src/config/config.js";
import { openBridgeDatabase } from "../src/storage/database.js";
import { createStorageRepositories } from "../src/storage/repositories.js";
import type { RunnerEvent, RunnerHandle, RunnerStartRequest, ToolRunner } from "../src/runner/ptyRunner.js";

const tempDirs: string[] = [];

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

describe("BridgeApp", () => {
  it("starts a session, forwards prompts, handles keyboard callbacks, stops, and reports status", async () => {
    const harness = await createHarness();
    await harness.app.start();

    await harness.adapter.emitMessage(textMessage("/new claude /tmp/project"));
    expect(harness.runner.starts).toHaveLength(1);
    expect(harness.runner.starts[0]).toMatchObject({
      tool: "claude",
      command: "/bin/claude",
      cwd: "/tmp/project"
    });
    expect(harness.adapter.sent.at(-1)?.message.text).toContain("Started claude session");

    await harness.adapter.emitMessage(textMessage("hello agent"));
    expect(harness.runner.handles[0]?.writes).toContain("hello agent\r");

    await harness.adapter.emitMessage(textMessage("/keyboard"));
    const keyboardMessage = harness.adapter.sent.at(-1);
    expect(keyboardMessage?.message.buttons?.flatMap((row) => row.buttons.map((button) => button.label))).toContain("Ctrl-C");

    const upButton = keyboardMessage?.message.buttons?.flatMap((row) => row.buttons).find((button) => button.label === "Up");
    expect(upButton).toBeDefined();
    await harness.adapter.emitInteraction({
      channel: "telegram",
      id: "callback-1",
      chat: { id: "chat-1", type: "private" },
      user: { id: "user-1" },
      value: upButton!.value
    });
    expect(harness.runner.handles[0]?.writes).toContain("\x1b[A");

    await harness.adapter.emitMessage(textMessage("/status"));
    expect(harness.adapter.sent.at(-1)?.message.text).toContain("Active session");

    await harness.adapter.emitMessage(textMessage("/stop"));
    expect(harness.runner.handles[0]?.writes).toContain("\x03");
    expect(harness.adapter.sent.at(-1)?.message.text).toContain("Stop requested");
  });

  it("denies unauthorized messages before they reach the runner", async () => {
    const harness = await createHarness();
    await harness.app.start();

    await harness.adapter.emitMessage({
      ...textMessage("/new codex"),
      user: { id: "intruder" },
      chat: { id: "intruder", type: "private" }
    });

    expect(harness.runner.starts).toHaveLength(0);
    expect(harness.adapter.sent.at(-1)?.message.text).toBe("Unauthorized.");
  });
});

async function createHarness() {
  const dir = await mkdtemp(join(tmpdir(), "cc-bridge-app-"));
  tempDirs.push(dir);
  const db = openBridgeDatabase(join(dir, "cc-bridge.sqlite"));
  const storage = createStorageRepositories(db);
  const config = await loadConfig({
    env: {
      TELEGRAM_BOT_TOKEN: "token",
      TELEGRAM_ALLOWED_USER_IDS: "user-1",
      CC_BRIDGE_ALLOWED_CWDS: "/tmp",
      CC_BRIDGE_DEFAULT_CWD: "/tmp/project",
      CLAUDE_COMMAND: "/bin/claude",
      CODEX_COMMAND: "/bin/codex"
    }
  });
  const adapter = new FakeAdapter();
  const runner = new FakeRunner();
  const app = createBridgeApp({
    config,
    adapter,
    storage,
    runner,
    now: () => "2026-05-03T10:00:00.000Z",
    idFactory: () => "bridge_1",
    nativeSessionIdFactory: () => "11111111-1111-4111-8111-111111111111"
  });

  return { app, adapter, runner };
}

function textMessage(text: string): InboundMessage {
  return {
    channel: "telegram",
    id: `message-${text}`,
    chat: { id: "chat-1", type: "private" },
    user: { id: "user-1" },
    text
  };
}

class FakeAdapter implements ChannelAdapter {
  readonly name = "telegram";
  readonly capabilities = {
    inlineButtons: true,
    messageEditing: true,
    fileDownload: true,
    typingIndicator: true,
    ephemeralInteractionAnswer: true,
    alertInteractionAnswer: true
  };
  readonly sent: Array<{ target: { channel: string; chatId: string }; message: OutboundMessage }> = [];
  readonly answers: unknown[] = [];
  private handlers: ChannelHandlers | null = null;

  async start(handlers: ChannelHandlers): Promise<void> {
    this.handlers = handlers;
  }

  async stop(): Promise<void> {}

  async sendMessage(target: { channel: string; chatId: string }, message: OutboundMessage): Promise<SentMessageRef> {
    this.sent.push({ target, message });
    return { channel: target.channel, chatId: target.chatId, messageId: `${this.sent.length}` };
  }

  async editMessage(): Promise<void> {}

  async answerInteraction(interaction: ChannelInteraction, response: unknown): Promise<void> {
    this.answers.push({ interaction, response });
  }

  async downloadAttachment(): Promise<never> {
    throw new Error("not used");
  }

  async emitMessage(message: InboundMessage): Promise<void> {
    if (!this.handlers) {
      throw new Error("adapter not started");
    }
    await this.handlers.onMessage(message);
  }

  async emitInteraction(interaction: ChannelInteraction): Promise<void> {
    if (!this.handlers) {
      throw new Error("adapter not started");
    }
    await this.handlers.onInteraction(interaction);
  }
}

class FakeRunner implements ToolRunner {
  readonly starts: RunnerStartRequest[] = [];
  readonly handles: FakeHandle[] = [];

  async start(request: RunnerStartRequest): Promise<RunnerHandle> {
    this.starts.push(request);
    const handle = new FakeHandle(request.sessionId, request.tool);
    this.handles.push(handle);
    request.onEvent({ kind: "started", sessionId: request.sessionId, pid: handle.pid });
    return handle;
  }
}

class FakeHandle implements RunnerHandle {
  readonly pid = 4321;
  readonly writes: string[] = [];
  readonly events: RunnerEvent[] = [];

  constructor(
    readonly sessionId: string,
    readonly tool: "codex" | "claude"
  ) {}

  write(data: string): void {
    this.writes.push(data);
  }

  interrupt(): void {
    this.write("\x03");
  }

  terminate(): void {}
}
