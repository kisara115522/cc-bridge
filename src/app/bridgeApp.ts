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
      case "switch":
      case "resume":
      case "fork":
      case "cwd":
      case "files":
        await send(principal, `${command.kind} is not wired in Telegram yet.`);
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

    const handle = await options.runner.start({
      sessionId: created.session.id,
      tool,
      command: created.command.command,
      args: created.command.args,
      cwd: created.command.cwd,
      env: {},
      cols: options.config.runtime.ptyCols,
      rows: options.config.runtime.ptyRows,
      onEvent: (event) => {
        recordRunnerEvent(event.sessionId, event.kind, event);
        if (event.kind === "started") {
          sessions.markRunning(created.session, event.pid);
        }
      }
    });
    handles.set(created.session.id, handle);
    await send(principal, `Started ${tool} session ${created.session.id}`);
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
