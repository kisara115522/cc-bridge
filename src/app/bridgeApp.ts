import { createAuthGuard } from "../auth/authGuard.js";
import type { ChannelAdapter, ChannelInteraction, InboundMessage } from "../channel/types.js";
import { COMMAND_HELP } from "../commands/help.js";
import { parseCommand, type ParsedCommand } from "../commands/parser.js";
import type { BridgeConfig } from "../config/config.js";
import { decodeCallbackData } from "../interaction/callbackData.js";
import { buildControlPadKeyboard } from "../interaction/keyboards.js";
import { callbackActionToPtyInput, expiredCallbackAnswer } from "../interaction/renderer.js";
import { SessionManager } from "../session/sessionManager.js";
import type { BridgeSessionRecord } from "../storage/repositories.js";
import type { RunnerHandle, ToolRunner } from "../runner/ptyRunner.js";
import { chunkTerminalOutput } from "../terminal/chunker.js";
import { createUploadStore } from "../uploads/uploadStore.js";

export interface BridgeAppOptions {
  readonly config: BridgeConfig;
  readonly adapter: ChannelAdapter;
  readonly storage: {
    sessions: ConstructorParameters<typeof SessionManager>[0]["sessions"];
    runnerEvents: {
      insert(event: {
        sessionId: string;
        type: string;
        sequence: number;
        payload: unknown;
        createdAt: string;
      }): number;
      maxSequence(sessionId: string): number;
    };
    interactionMessages: {
      insert(message: {
        interactionId: string;
        sessionId: string;
        channel: string;
        chatId: string;
        messageId: string;
        kind: string;
        payload: unknown;
        expiresAt: string | null;
        createdAt: string;
      }): void;
      get(interactionId: string): {
        interactionId: string;
        sessionId: string;
        channel: string;
        chatId: string;
        messageId: string;
        kind: string;
        payload: unknown;
        expiresAt: string | null;
        createdAt: string;
      } | null;
    };
    uploads: {
      insert(upload: {
        sessionId: string;
        channel: string;
        channelFileId: string;
        originalFilename: string | null;
        mimeType: string | null;
        localPath: string;
        sizeBytes: number;
        caption: string | null;
        createdAt: string;
      }): number;
      list(sessionId: string): Array<{
        originalFilename: string | null;
        localPath: string;
        sizeBytes: number;
        createdAt: string;
      }>;
    };
    auditLogs: {
      insert(log: {
        channel: string;
        chatId: string | null;
        userId: string | null;
        action: string;
        sessionId: string | null;
        details: unknown;
        createdAt: string;
      }): number;
    };
  };
  readonly runner: ToolRunner;
  readonly uploadStore?: {
    save(input: {
      sessionId: string;
      attachmentId: string;
      filename?: string;
      mimeType?: string;
      data: Uint8Array;
    }): Promise<{
      sessionId: string;
      attachmentId: string;
      filename: string;
      mimeType?: string;
      localPath: string;
      sizeBytes: number;
    }>;
  };
  readonly now?: () => string;
  readonly idFactory?: () => string;
  readonly nativeSessionIdFactory?: () => string;
}

export interface BridgeApp {
  start(): Promise<void>;
  stop(): Promise<void>;
}

export function createBridgeApp(options: BridgeAppOptions): BridgeApp {
  const now = options.now ?? (() => new Date().toISOString());
  const auth = createAuthGuard({
    allowedUserIds: options.config.telegram.allowedUserIds,
    allowedChatIds: options.config.telegram.allowedChatIds,
    allowAllUsers: options.config.security.allowAllUsers
  });
  const sessions = new SessionManager({
    config: options.config,
    sessions: options.storage.sessions,
    now,
    idFactory: options.idFactory ?? (() => crypto.randomUUID()),
    nativeSessionIdFactory: options.nativeSessionIdFactory ?? (() => crypto.randomUUID())
  });
  const handles = new Map<string, RunnerHandle>();
  const sequences = new Map<string, number>();
  const outputBuffers = new Map<string, { text: string; timer: ReturnType<typeof setTimeout> | null }>();
  const flushMs = options.config.runtime.outputFlushMs;
  const uploadStore =
    options.uploadStore ?? createUploadStore({ stateDir: options.config.runtime.stateDir });

  async function handleMessage(message: InboundMessage): Promise<void> {
    const decision = auth.authorize({
      channel: message.channel,
      chat: message.chat,
      user: message.user
    });
    if (!decision.allowed) {
      options.storage.auditLogs.insert({
        channel: message.channel,
        chatId: message.chat.id,
        userId: message.user?.id ?? null,
        action: "auth.denied",
        sessionId: null,
        details: { reason: decision.reason },
        createdAt: now()
      });
      await options.adapter.sendMessage({ channel: message.channel, chatId: message.chat.id }, { text: decision.message });
      return;
    }

    const command = parseCommand(message.text ?? "");
    await routeCommand(command, {
      channel: message.channel,
      chatId: message.chat.id,
      userId: decision.principal.userId
    });
    if (message.attachments && message.attachments.length > 0) {
      await handleAttachments(message, {
        channel: message.channel,
        chatId: message.chat.id,
        userId: decision.principal.userId
      });
    }
  }

  async function routeCommand(
    command: ParsedCommand,
    principal: { channel: string; chatId: string; userId: string }
  ): Promise<void> {
    switch (command.kind) {
      case "start":
      case "help":
        await send(principal, COMMAND_HELP);
        return;
      case "invalid":
        await send(principal, command.reason);
        return;
      case "new":
        await startNewSession(principal, command.tool, command.cwd);
        return;
      case "forward":
        await writeToActive(principal, `${command.text}\r`);
        return;
      case "raw":
        await writeToActive(principal, command.text);
        return;
      case "send":
        await writeToActive(principal, `${command.text}\r`);
        return;
      case "keyboard":
        await showKeyboard(principal);
        return;
      case "stop":
        await stopActive(principal);
        return;
      case "status":
        await send(principal, formatStatus(sessions.getActive(principal.channel, principal.chatId, principal.userId)));
        return;
      case "doctor":
        await send(principal, "Doctor is available from the local CLI in this build.");
        return;
      case "sessions":
        await send(principal, formatSessionList(sessions.listForPrincipal(principal.channel, principal.chatId, principal.userId)));
        return;
      case "switch":
        await switchSession(principal, command.id);
        return;
      case "resume":
        await resumeSession(principal, command.id);
        return;
      case "fork":
        await forkSession(principal, command.id);
        return;
      case "cwd":
        await send(principal, formatCwd(command.value, sessions.getActive(principal.channel, principal.chatId, principal.userId)));
        return;
      case "files":
        await listFiles(principal);
        return;
    }
  }

  async function startNewSession(
    principal: { channel: string; chatId: string; userId: string },
    tool: "codex" | "claude",
    cwd: string | null
  ): Promise<void> {
    let created;
    try {
      created = sessions.create({
        channel: principal.channel,
        chatId: principal.chatId,
        userId: principal.userId,
        tool,
        cwd
      });
    } catch (error) {
      await send(principal, error instanceof Error ? error.message : String(error));
      return;
    }

    const handle = await startRunnerForSession(created.session, created.command, tool);
    await send(principal, `Started ${tool} session ${created.session.id}`);
  }

  async function startRunnerForSession(
    session: BridgeSessionRecord,
    command: { command: string; args: string[]; cwd: string },
    tool: "codex" | "claude"
  ): Promise<RunnerHandle> {
    // Initialize sequence from database to avoid UNIQUE constraint on resume
    sequences.set(session.id, options.storage.runnerEvents.maxSequence(session.id));

    const handle = await options.runner.start({
      sessionId: session.id,
      tool,
      command: command.command,
      args: command.args,
      cwd: command.cwd,
      env: {},
      cols: options.config.runtime.ptyCols,
      rows: options.config.runtime.ptyRows,
      onEvent: (event) => {
        recordRunnerEvent(event.sessionId, event.kind, event);
        if (event.kind === "started") {
          sessions.markRunning(session, event.pid);
        }
        if (event.kind === "output") {
          bufferRunnerOutput(session, event.data);
        }
      }
    });
    handles.set(session.id, handle);
    return handle;
  }

  async function writeToActive(
    principal: { channel: string; chatId: string; userId: string },
    data: string
  ): Promise<void> {
    const session = sessions.getActive(principal.channel, principal.chatId, principal.userId);
    if (!session) {
      await send(principal, "No active session. Use /new codex or /new claude.");
      return;
    }
    const handle = handles.get(session.id);
    if (!handle) {
      await send(principal, "Active session has no running PTY. Use /resume or /new.");
      return;
    }
    handle.write(data);
    sessions.touch(session);
  }

  async function showKeyboard(principal: { channel: string; chatId: string; userId: string }): Promise<void> {
    const session = sessions.getActive(principal.channel, principal.chatId, principal.userId);
    if (!session) {
      await send(principal, "No active session. Use /new codex or /new claude.");
      return;
    }
    const interactionId = `kbd_${session.id}_${Date.now()}`;
    const sent = await options.adapter.sendMessage(
      { channel: principal.channel, chatId: principal.chatId },
      {
        text: `Keyboard for ${session.id}`,
        buttons: buildControlPadKeyboard(interactionId)
      }
    );
    options.storage.interactionMessages.insert({
      interactionId,
      sessionId: session.id,
      channel: principal.channel,
      chatId: principal.chatId,
      messageId: sent.messageId,
      kind: "keyboard",
      payload: { sessionId: session.id },
      expiresAt: null,
      createdAt: now()
    });
  }

  async function stopActive(principal: { channel: string; chatId: string; userId: string }): Promise<void> {
    const session = sessions.getActive(principal.channel, principal.chatId, principal.userId);
    if (!session) {
      await send(principal, "No active session.");
      return;
    }
    handles.get(session.id)?.interrupt();
    sessions.markStopped(session);
    await send(principal, `Stop requested for ${session.id}`);
  }

  async function handleAttachments(
    message: InboundMessage,
    principal: { channel: string; chatId: string; userId: string }
  ): Promise<void> {
    const session = sessions.getActive(principal.channel, principal.chatId, principal.userId);
    if (!session) {
      await send(principal, "No active session for attachment. Use /new codex or /new claude.");
      return;
    }
    const handle = handles.get(session.id);
    for (const attachment of message.attachments ?? []) {
      const downloaded = await options.adapter.downloadAttachment(attachment);
      const saved = await uploadStore.save({
        sessionId: session.id,
        attachmentId: downloaded.attachmentId,
        filename: downloaded.filename,
        mimeType: downloaded.mimeType,
        data: downloaded.data
      });
      options.storage.uploads.insert({
        sessionId: session.id,
        channel: message.channel,
        channelFileId: attachment.id,
        originalFilename: saved.filename,
        mimeType: saved.mimeType ?? null,
        localPath: saved.localPath,
        sizeBytes: saved.sizeBytes,
        caption: message.text ?? null,
        createdAt: now()
      });
      handle?.write(`Attachment saved: ${saved.localPath}\r`);
    }
  }

  async function listFiles(principal: { channel: string; chatId: string; userId: string }): Promise<void> {
    const session = sessions.getActive(principal.channel, principal.chatId, principal.userId);
    if (!session) {
      await send(principal, "No active session.");
      return;
    }
    const files = options.storage.uploads.list(session.id);
    if (files.length === 0) {
      await send(principal, `No files for ${session.id}.`);
      return;
    }
    await send(
      principal,
      [
        `Files for ${session.id}:`,
        ...files.map(
          (file) =>
            `- ${file.originalFilename ?? "upload"} ${file.sizeBytes} bytes ${file.localPath}`
        )
      ].join("\n")
    );
  }

  async function switchSession(
    principal: { channel: string; chatId: string; userId: string },
    id: string
  ): Promise<void> {
    try {
      const session = sessions.switchActive(id);
      if (
        session.channel !== principal.channel ||
        session.channelChatId !== principal.chatId ||
        session.channelUserId !== principal.userId
      ) {
        await send(principal, `Bridge session not found: ${id}`);
        return;
      }
      await send(principal, `Switched to ${id}`);
    } catch (error) {
      await send(principal, error instanceof Error ? error.message : String(error));
    }
  }

  async function resumeSession(
    principal: { channel: string; chatId: string; userId: string },
    id: string
  ): Promise<void> {
    try {
      const resumed = sessions.resume(id);
      if (!belongsToPrincipal(resumed.session, principal)) {
        await send(principal, `Bridge session not found: ${id}`);
        return;
      }
      await startRunnerForSession(resumed.session, resumed.command, resumed.session.tool);
      await send(principal, `Resumed ${id}`);
    } catch (error) {
      await send(principal, error instanceof Error ? error.message : String(error));
    }
  }

  async function forkSession(
    principal: { channel: string; chatId: string; userId: string },
    id: string
  ): Promise<void> {
    try {
      const forked = sessions.fork(id);
      if (!belongsToPrincipal(forked.session, principal)) {
        await send(principal, `Bridge session not found: ${id}`);
        return;
      }
      await startRunnerForSession(forked.session, forked.command, forked.session.tool);
      await send(principal, `Forked ${id} into ${forked.session.id}`);
    } catch (error) {
      await send(principal, error instanceof Error ? error.message : String(error));
    }
  }

  async function handleInteraction(interaction: ChannelInteraction): Promise<void> {
    const decoded = decodeCallbackData(interaction.value);
    if (!decoded) {
      await options.adapter.answerInteraction(interaction, { text: "Unknown action.", showAlert: false });
      return;
    }
    const stored = options.storage.interactionMessages.get(decoded.interactionId);
    if (!stored) {
      await options.adapter.answerInteraction(interaction, expiredCallbackAnswer());
      return;
    }
    const input = callbackActionToPtyInput(decoded.action);
    if (input) {
      handles.get(stored.sessionId)?.write(input);
    }
    await options.adapter.answerInteraction(interaction, { text: decoded.action, showAlert: false });
  }

  function recordRunnerEvent(sessionId: string, type: string, payload: unknown): void {
    const sequence = (sequences.get(sessionId) ?? 0) + 1;
    sequences.set(sessionId, sequence);
    options.storage.runnerEvents.insert({
      sessionId,
      type,
      sequence,
      payload,
      createdAt: now()
    });
  }

  function bufferRunnerOutput(session: BridgeSessionRecord, data: string): void {
    let buffer = outputBuffers.get(session.id);
    if (!buffer) {
      buffer = { text: "", timer: null };
      outputBuffers.set(session.id, buffer);
    }

    buffer.text += data;

    if (buffer.timer) {
      clearTimeout(buffer.timer);
    }

    buffer.timer = setTimeout(() => {
      flushOutputBuffer(session.id);
    }, flushMs);
  }

  async function flushOutputBuffer(sessionId: string): Promise<void> {
    const buffer = outputBuffers.get(sessionId);
    if (!buffer || buffer.text.length === 0) {
      return;
    }

    const text = buffer.text;
    buffer.text = "";
    buffer.timer = null;

    const session = sessions.get(sessionId);
    if (!session) {
      return;
    }

    for (const chunk of chunkTerminalOutput(text, {
      maxChars: options.config.runtime.maxTelegramMessageChars
    })) {
      try {
        await options.adapter.sendMessage(
          { channel: session.channel, chatId: session.channelChatId },
          { text: chunk }
        );
      } catch (error) {
        options.storage.auditLogs.insert({
          channel: session.channel,
          chatId: session.channelChatId,
          userId: session.channelUserId,
          action: "telegram.output_delivery_failed",
          sessionId,
          details: { error: error instanceof Error ? error.message : String(error) },
          createdAt: now()
        });
      }
    }
  }

  function cleanupSessionBuffer(sessionId: string): void {
    const buffer = outputBuffers.get(sessionId);
    if (buffer) {
      if (buffer.timer) {
        clearTimeout(buffer.timer);
      }
      outputBuffers.delete(sessionId);
    }
  }

  async function sendRunnerOutput(session: BridgeSessionRecord, data: string): Promise<void> {
    for (const chunk of chunkTerminalOutput(data, {
      maxChars: options.config.runtime.maxTelegramMessageChars
    })) {
      await options.adapter.sendMessage(
        { channel: session.channel, chatId: session.channelChatId },
        { text: chunk }
      );
    }
  }

  async function send(
    principal: { channel: string; chatId: string },
    text: string
  ): Promise<void> {
    await options.adapter.sendMessage({ channel: principal.channel, chatId: principal.chatId }, { text });
  }

  return {
    async start() {
      await options.adapter.start({
        onMessage: handleMessage,
        onInteraction: handleInteraction
      });
    },
    async stop() {
      await options.adapter.stop();
    }
  };
}

function formatSessionList(sessions: BridgeSessionRecord[]): string {
  if (sessions.length === 0) {
    return "No sessions yet. Use /new codex or /new claude.";
  }

  return [
    "Sessions:",
    ...sessions.map((session) => {
      const active = session.isActive ? "*" : "-";
      return `${active} ${session.id} ${session.tool} ${session.status} ${session.cwd}`;
    })
  ].join("\n");
}

function formatCwd(requested: string | null, session: BridgeSessionRecord | null): string {
  if (requested) {
    return "Changing cwd for existing sessions is not supported yet. Start a new session with /new <tool> <cwd>.";
  }
  return session ? `Current cwd: ${session.cwd}` : "No active session.";
}

function belongsToPrincipal(
  session: BridgeSessionRecord,
  principal: { channel: string; chatId: string; userId: string }
): boolean {
  return (
    session.channel === principal.channel &&
    session.channelChatId === principal.chatId &&
    session.channelUserId === principal.userId
  );
}

function formatStatus(session: BridgeSessionRecord | null): string {
  if (!session) {
    return "No active session.";
  }
  return [
    `Active session: ${session.id}`,
    `Tool: ${session.tool}`,
    `Status: ${session.status}`,
    `CWD: ${session.cwd}`,
    `Native confidence: ${session.native?.confidence ?? "none"}`
  ].join("\n");
}
