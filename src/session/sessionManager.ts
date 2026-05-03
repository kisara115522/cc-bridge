import type { BridgeConfig } from "../config/config.js";
import {
  buildNativeSessionCommand,
  type NativeSessionCommand
} from "../native/nativeSession.js";
import type {
  BridgeSessionRecord,
  BridgeTool,
  NativeSessionRef
} from "../storage/repositories.js";

export interface SessionManagerOptions {
  readonly config: BridgeConfig;
  readonly sessions: {
    upsert(session: BridgeSessionRecord): void;
    get(id: string): BridgeSessionRecord | null;
    getActive(channel: string, chatId: string, userId: string): BridgeSessionRecord | null;
    listForPrincipal(channel: string, chatId: string, userId: string): BridgeSessionRecord[];
    setActive(id: string): void;
  };
  readonly now: () => string;
  readonly idFactory: () => string;
  readonly nativeSessionIdFactory: () => string;
}

export interface NewSessionRequest {
  readonly channel: string;
  readonly chatId: string;
  readonly userId: string;
  readonly tool: BridgeTool;
  readonly cwd: string | null;
}

export interface CreatedSession {
  readonly session: BridgeSessionRecord;
  readonly command: NativeSessionCommand;
}

export interface ExistingSessionStart {
  readonly session: BridgeSessionRecord;
  readonly command: NativeSessionCommand;
}

export class SessionManager {
  constructor(private readonly options: SessionManagerOptions) {}

  create(request: NewSessionRequest): CreatedSession {
    const cwd = this.resolveCwd(request.cwd);
    const now = this.options.now();
    const sessionId = this.options.idFactory();
    const nativeId = request.tool === "claude" ? this.options.nativeSessionIdFactory() : null;
    const toolConfig = this.options.config.tools[request.tool];
    const command = buildNativeSessionCommand({
      tool: request.tool,
      action: "new",
      command: toolConfig.command,
      baseArgs: toolConfig.args,
      cwd,
      sessionId: nativeId ?? undefined
    });
    const native: NativeSessionRef | null =
      request.tool === "claude"
        ? {
            tool: "claude",
            id: nativeId,
            resumeCommand: [
              toolConfig.command,
              "--resume",
              nativeId ?? ""
            ],
            discoveredAt: now,
            confidence: "explicit"
          }
        : {
            tool: "codex",
            id: null,
            resumeCommand: [],
            discoveredAt: null,
            confidence: "unknown"
          };
    const session: BridgeSessionRecord = {
      id: sessionId,
      channel: request.channel,
      channelChatId: request.chatId,
      channelUserId: request.userId,
      tool: request.tool,
      cwd,
      status: "starting",
      activePtyPid: null,
      native,
      createdAt: now,
      updatedAt: now,
      lastActiveAt: now,
      title: `${request.tool} ${cwd}`,
      isActive: true
    };

    this.options.sessions.upsert(session);
    return { session, command };
  }

  getActive(channel: string, chatId: string, userId: string): BridgeSessionRecord | null {
    return this.options.sessions.getActive(channel, chatId, userId);
  }

  get(id: string): BridgeSessionRecord | null {
    return this.options.sessions.get(id);
  }

  listForPrincipal(channel: string, chatId: string, userId: string): BridgeSessionRecord[] {
    return this.options.sessions.listForPrincipal(channel, chatId, userId);
  }

  switchActive(id: string): BridgeSessionRecord {
    const session = this.requireSession(id);
    this.options.sessions.setActive(id);
    return {
      ...session,
      isActive: true
    };
  }

  resume(id: string): ExistingSessionStart {
    const session = this.switchActive(id);
    return {
      session,
      command: this.buildExistingCommand(session, "resume")
    };
  }

  fork(id: string): ExistingSessionStart {
    const source = this.requireSession(id);
    const command = this.buildExistingCommand(source, "fork");
    const now = this.options.now();
    const forked: BridgeSessionRecord = {
      ...source,
      id: this.options.idFactory(),
      status: "starting",
      activePtyPid: null,
      native: {
        tool: source.tool,
        id: null,
        resumeCommand: [],
        discoveredAt: null,
        confidence: "unknown"
      },
      createdAt: now,
      updatedAt: now,
      lastActiveAt: now,
      title: `fork of ${source.id}`,
      isActive: true
    };
    this.options.sessions.upsert(forked);
    return {
      session: forked,
      command
    };
  }

  markRunning(session: BridgeSessionRecord, pid: number): BridgeSessionRecord {
    const updated = this.patch(session, {
      status: "running",
      activePtyPid: pid
    });
    this.options.sessions.upsert(updated);
    return updated;
  }

  markStopped(session: BridgeSessionRecord): BridgeSessionRecord {
    const updated = this.patch(session, {
      status: "stopped",
      activePtyPid: null
    });
    this.options.sessions.upsert(updated);
    return updated;
  }

  touch(session: BridgeSessionRecord): BridgeSessionRecord {
    const updated = this.patch(session, {});
    this.options.sessions.upsert(updated);
    return updated;
  }

  private buildExistingCommand(
    session: BridgeSessionRecord,
    action: "resume" | "fork"
  ): NativeSessionCommand {
    if (!session.native?.id) {
      throw new Error(`${session.tool} native session is not available for ${action}`);
    }

    const toolConfig = this.options.config.tools[session.tool];
    return buildNativeSessionCommand({
      tool: session.tool,
      action,
      command: toolConfig.command,
      baseArgs: toolConfig.args,
      cwd: session.cwd,
      sessionId: session.native.id
    });
  }

  private requireSession(id: string): BridgeSessionRecord {
    const session = this.options.sessions.get(id);
    if (!session) {
      throw new Error(`Bridge session not found: ${id}`);
    }
    return session;
  }

  private patch(
    session: BridgeSessionRecord,
    values: Partial<Pick<BridgeSessionRecord, "status" | "activePtyPid">>
  ): BridgeSessionRecord {
    const now = this.options.now();
    return {
      ...session,
      ...values,
      updatedAt: now,
      lastActiveAt: now
    };
  }

  private resolveCwd(requested: string | null): string {
    const cwd = requested ?? this.options.config.security.defaultCwd;
    const allowed = this.options.config.security.allowedCwds.some(
      (allowedCwd) => cwd === allowedCwd || cwd.startsWith(`${allowedCwd}/`)
    );

    if (!allowed) {
      throw new Error(`Requested cwd is outside the allowlist: ${cwd}`);
    }

    return cwd;
  }
}
