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

  it("lists, switches, resumes, forks, and streams session output", async () => {
    const harness = await createHarness();
    await harness.app.start();

    await harness.adapter.emitMessage(textMessage("/new claude /tmp/project"));
    await harness.adapter.emitMessage(textMessage("/new codex /tmp/project"));

    await harness.adapter.emitMessage(textMessage("/sessions"));
    expect(harness.adapter.sent.at(-1)?.message.text).toContain("bridge_2");
    expect(harness.adapter.sent.at(-1)?.message.text).toContain("bridge_1");

    await harness.adapter.emitMessage(textMessage("/switch bridge_1"));
    expect(harness.adapter.sent.at(-1)?.message.text).toContain("Switched to bridge_1");

    harness.runner.emitOutput(0, "agent says hello");
    await waitForOutputFlush();
    expect(harness.adapter.sent.at(-1)?.message.text).toBe("agent says hello");

    await harness.adapter.emitMessage(textMessage("/resume bridge_1"));
    expect(harness.runner.starts.at(-1)?.args).toEqual([
      "--resume",
      "11111111-1111-4111-8111-000000000001"
    ]);
    expect(harness.adapter.sent.at(-1)?.message.text).toContain("Resumed bridge_1");

    await harness.adapter.emitMessage(textMessage("/fork bridge_1"));
    expect(harness.runner.starts.at(-1)?.args).toEqual([
      "--resume",
      "11111111-1111-4111-8111-000000000001",
      "--fork-session"
    ]);
    expect(harness.adapter.sent.at(-1)?.message.text).toContain("Forked bridge_1 into bridge_3");
  });

  it("downloads attachments, stores them, forwards local paths, and lists files", async () => {
    const harness = await createHarness();
    await harness.app.start();

    await harness.adapter.emitMessage(textMessage("/new claude /tmp/project"));
    await harness.adapter.emitMessage({
      ...textMessage("inspect this"),
      attachments: [{ id: "telegram-file-1", filename: "notes.txt", mimeType: "text/plain" }]
    });

    expect(harness.adapter.downloadedIds).toEqual(["telegram-file-1"]);
    expect(harness.uploadStore.saved).toHaveLength(1);
    expect(harness.runner.handles[0]?.writes.at(-1)).toContain("Attachment saved: /tmp/uploads/bridge_1/notes.txt");

    await harness.adapter.emitMessage(textMessage("/files"));
    expect(harness.adapter.sent.at(-1)?.message.text).toContain("notes.txt");
    expect(harness.adapter.sent.at(-1)?.message.text).toContain("/tmp/uploads/bridge_1/notes.txt");
  });

  it("coalesces fragmented terminal output before sending it to Telegram", async () => {
    const harness = await createHarness();
    await harness.app.start();
    await harness.adapter.emitMessage(textMessage("/new codex /tmp/project"));

    harness.runner.emitOutput(0, "\x1b[?25lSta");
    harness.runner.emitOutput(0, "rting MCP ser");
    harness.runner.emitOutput(0, "vers\x1b[?25h\nReady");
    await waitForOutputFlush();

    const outputMessages = harness.adapter.sent
      .map((entry) => entry.message.text)
      .filter((text) => text.includes("Starting") || text.includes("Ready"));
    expect(outputMessages).toEqual(["Starting MCP servers\nReady"]);
  });

  it("keeps the bridge alive when Telegram rejects a runner output message", async () => {
    const harness = await createHarness();
    await harness.app.start();
    await harness.adapter.emitMessage(textMessage("/new codex /tmp/project"));

    harness.adapter.failNextSend(new Error("Telegram sendMessage failed: 429"));
    harness.runner.emitOutput(0, "noisy terminal output");
    await waitForOutputFlush();

    await harness.adapter.emitMessage(textMessage("/status"));
    expect(harness.adapter.sent.at(-1)?.message.text).toContain("Active session");
    expect(harness.storage.auditLogs.list()).toContainEqual(
      expect.objectContaining({
        action: "telegram.output_delivery_failed",
        sessionId: "bridge_1"
      })
    );
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
    },
    overrides: {
      runtime: {
        outputFlushMs: 1
      }
    }
  });
  const adapter = new FakeAdapter();
  const runner = new FakeRunner();
  const uploadStore = new FakeUploadStore();
  let nextBridgeId = 1;
  let nextNativeId = 1;
  const app = createBridgeApp({
    config,
    adapter,
    storage,
    runner,
    uploadStore,
    now: () => "2026-05-03T10:00:00.000Z",
    idFactory: () => `bridge_${nextBridgeId++}`,
    nativeSessionIdFactory: () =>
      `11111111-1111-4111-8111-${String(nextNativeId++).padStart(12, "0")}`
  });

  return { app, adapter, runner, storage, uploadStore };
}

function waitForOutputFlush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 5));
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
  readonly downloadedIds: string[] = [];
  private handlers: ChannelHandlers | null = null;
  private nextSendError: Error | null = null;

  async start(handlers: ChannelHandlers): Promise<void> {
    this.handlers = handlers;
  }

  async stop(): Promise<void> {}

  async sendMessage(target: { channel: string; chatId: string }, message: OutboundMessage): Promise<SentMessageRef> {
    if (this.nextSendError) {
      const error = this.nextSendError;
      this.nextSendError = null;
      throw error;
    }
    this.sent.push({ target, message });
    return { channel: target.channel, chatId: target.chatId, messageId: `${this.sent.length}` };
  }

  failNextSend(error: Error): void {
    this.nextSendError = error;
  }

  async editMessage(): Promise<void> {}

  async answerInteraction(interaction: ChannelInteraction, response: unknown): Promise<void> {
    this.answers.push({ interaction, response });
  }

  async downloadAttachment(attachment: { id: string; filename?: string; mimeType?: string }) {
    this.downloadedIds.push(attachment.id);
    return {
      attachmentId: attachment.id,
      filename: attachment.filename,
      mimeType: attachment.mimeType,
      data: new TextEncoder().encode("hello")
    };
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

class FakeUploadStore {
  readonly saved: Array<{
    sessionId: string;
    attachmentId: string;
    filename: string;
    mimeType?: string;
    localPath: string;
    sizeBytes: number;
  }> = [];

  async save(input: {
    sessionId: string;
    attachmentId: string;
    filename?: string;
    mimeType?: string;
    data: Uint8Array;
  }) {
    const saved = {
      sessionId: input.sessionId,
      attachmentId: input.attachmentId,
      filename: input.filename ?? input.attachmentId,
      mimeType: input.mimeType,
      localPath: `/tmp/uploads/${input.sessionId}/${input.filename ?? input.attachmentId}`,
      sizeBytes: input.data.byteLength
    };
    this.saved.push(saved);
    return saved;
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

  emitOutput(index: number, data: string): void {
    const request = this.starts[index];
    if (!request) {
      throw new Error(`No runner request at ${index}`);
    }
    request.onEvent({ kind: "output", sessionId: request.sessionId, data });
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
