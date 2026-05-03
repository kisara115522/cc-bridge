import type { Database } from "better-sqlite3";

export type BridgeTool = "codex" | "claude";
export type BridgeSessionStatus =
  | "starting"
  | "running"
  | "awaiting_input"
  | "idle"
  | "stopped"
  | "exited"
  | "errored";

export interface NativeSessionRef {
  tool: BridgeTool;
  id: string | null;
  resumeCommand: string[];
  discoveredAt: string | null;
  confidence: "explicit" | "discovered" | "last-resort" | "unknown";
}

export interface BridgeSessionRecord {
  id: string;
  channel: string;
  channelChatId: string;
  channelUserId: string;
  tool: BridgeTool;
  cwd: string;
  status: BridgeSessionStatus;
  activePtyPid: number | null;
  native: NativeSessionRef | null;
  createdAt: string;
  updatedAt: string;
  lastActiveAt: string;
  title: string | null;
  isActive: boolean;
}

export interface RunnerEventInput {
  sessionId: string;
  type: string;
  sequence: number;
  payload: JsonValue;
  createdAt: string;
}

export interface RunnerEventRecord extends RunnerEventInput {
  id: number;
}

export interface InteractionMessageInput {
  interactionId: string;
  sessionId: string;
  channel: string;
  chatId: string;
  messageId: string;
  kind: string;
  payload: JsonValue;
  expiresAt: string | null;
  createdAt: string;
}

export type InteractionMessageRecord = InteractionMessageInput;

export interface UploadInput {
  sessionId: string;
  channel: string;
  channelFileId: string;
  originalFilename: string | null;
  mimeType: string | null;
  localPath: string;
  sizeBytes: number;
  caption: string | null;
  createdAt: string;
}

export interface UploadRecord extends UploadInput {
  id: number;
}

export interface AuditLogInput {
  channel: string;
  chatId: string | null;
  userId: string | null;
  action: string;
  sessionId: string | null;
  details: JsonValue;
  createdAt: string;
}

export interface AuditLogRecord extends AuditLogInput {
  id: number;
}

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

interface BridgeSessionRow {
  id: string;
  channel: string;
  channel_chat_id: string;
  channel_user_id: string;
  tool: BridgeTool;
  cwd: string;
  status: BridgeSessionStatus;
  active_pty_pid: number | null;
  created_at: string;
  updated_at: string;
  last_active_at: string;
  title: string | null;
  is_active: 0 | 1;
  native_tool: BridgeTool | null;
  native_id: string | null;
  resume_command_json: string | null;
  discovered_at: string | null;
  confidence: NativeSessionRef["confidence"] | null;
}

interface RunnerEventRow {
  id: number;
  bridge_session_id: string;
  type: string;
  sequence: number;
  payload_json: string;
  created_at: string;
}

interface InteractionMessageRow {
  interaction_id: string;
  bridge_session_id: string;
  channel: string;
  chat_id: string;
  message_id: string;
  kind: string;
  payload_json: string;
  expires_at: string | null;
  created_at: string;
}

interface UploadRow {
  id: number;
  bridge_session_id: string;
  channel: string;
  channel_file_id: string;
  original_filename: string | null;
  mime_type: string | null;
  local_path: string;
  size_bytes: number;
  caption: string | null;
  created_at: string;
}

interface AuditLogRow {
  id: number;
  channel: string;
  chat_id: string | null;
  user_id: string | null;
  action: string;
  bridge_session_id: string | null;
  details_json: string;
  created_at: string;
}

export function createStorageRepositories(db: Database) {
  return {
    sessions: createSessionRepository(db),
    runnerEvents: createRunnerEventRepository(db),
    interactionMessages: createInteractionMessageRepository(db),
    uploads: createUploadRepository(db),
    auditLogs: createAuditLogRepository(db),
  };
}

function createSessionRepository(db: Database) {
  const selectById = db.prepare<string>(sessionSelectSql("where s.id = ?"));
  const selectActive = db.prepare<[string, string, string]>(
    sessionSelectSql(
      "where s.channel = ? and s.channel_chat_id = ? and s.channel_user_id = ? and s.is_active = 1"
    )
  );
  const clearActive = db.prepare<[string, string, string]>(`
    update bridge_sessions
    set is_active = 0
    where channel = ? and channel_chat_id = ? and channel_user_id = ?
  `);
  const upsertSession = db.prepare(`
    insert into bridge_sessions (
      id, channel, channel_chat_id, channel_user_id, tool, cwd, status,
      active_pty_pid, created_at, updated_at, last_active_at, title, is_active
    ) values (
      @id, @channel, @channelChatId, @channelUserId, @tool, @cwd, @status,
      @activePtyPid, @createdAt, @updatedAt, @lastActiveAt, @title, @isActive
    )
    on conflict(id) do update set
      channel = excluded.channel,
      channel_chat_id = excluded.channel_chat_id,
      channel_user_id = excluded.channel_user_id,
      tool = excluded.tool,
      cwd = excluded.cwd,
      status = excluded.status,
      active_pty_pid = excluded.active_pty_pid,
      created_at = excluded.created_at,
      updated_at = excluded.updated_at,
      last_active_at = excluded.last_active_at,
      title = excluded.title,
      is_active = excluded.is_active
  `);
  const deleteNative = db.prepare<string>("delete from native_sessions where bridge_session_id = ?");
  const upsertNative = db.prepare(`
    insert into native_sessions (
      bridge_session_id, tool, native_id, resume_command_json, discovered_at, confidence
    ) values (
      @sessionId, @tool, @id, @resumeCommandJson, @discoveredAt, @confidence
    )
    on conflict(bridge_session_id) do update set
      tool = excluded.tool,
      native_id = excluded.native_id,
      resume_command_json = excluded.resume_command_json,
      discovered_at = excluded.discovered_at,
      confidence = excluded.confidence
  `);

  const writeSession = db.transaction((session: BridgeSessionRecord) => {
    if (session.isActive) {
      clearActive.run(session.channel, session.channelChatId, session.channelUserId);
    }

    upsertSession.run({
      ...session,
      isActive: booleanToSql(session.isActive),
    });

    deleteNative.run(session.id);
    if (session.native) {
      upsertNative.run({
        sessionId: session.id,
        tool: session.native.tool,
        id: session.native.id,
        resumeCommandJson: JSON.stringify(session.native.resumeCommand),
        discoveredAt: session.native.discoveredAt,
        confidence: session.native.confidence,
      });
    }
  });

  return {
    upsert(session: BridgeSessionRecord): void {
      writeSession(session);
    },
    get(id: string): BridgeSessionRecord | null {
      const row = selectById.get(id) as BridgeSessionRow | undefined;
      return row ? mapSession(row) : null;
    },
    getActive(channel: string, chatId: string, userId: string): BridgeSessionRecord | null {
      const row = selectActive.get(channel, chatId, userId) as BridgeSessionRow | undefined;
      return row ? mapSession(row) : null;
    },
  };
}

function createRunnerEventRepository(db: Database) {
  const insert = db.prepare(`
    insert into runner_events (
      bridge_session_id, type, sequence, payload_json, created_at
    ) values (
      @sessionId, @type, @sequence, @payloadJson, @createdAt
    )
  `);
  const list = db.prepare<string>(`
    select id, bridge_session_id, type, sequence, payload_json, created_at
    from runner_events
    where bridge_session_id = ?
    order by sequence asc, id asc
  `);

  return {
    insert(event: RunnerEventInput): number {
      const result = insert.run({
        ...event,
        payloadJson: JSON.stringify(event.payload),
      });
      return Number(result.lastInsertRowid);
    },
    list(sessionId: string): RunnerEventRecord[] {
      return (list.all(sessionId) as RunnerEventRow[]).map(mapRunnerEvent);
    },
  };
}

function createInteractionMessageRepository(db: Database) {
  const insert = db.prepare(`
    insert into interaction_messages (
      interaction_id, bridge_session_id, channel, chat_id, message_id, kind,
      payload_json, expires_at, created_at
    ) values (
      @interactionId, @sessionId, @channel, @chatId, @messageId, @kind,
      @payloadJson, @expiresAt, @createdAt
    )
    on conflict(interaction_id) do update set
      bridge_session_id = excluded.bridge_session_id,
      channel = excluded.channel,
      chat_id = excluded.chat_id,
      message_id = excluded.message_id,
      kind = excluded.kind,
      payload_json = excluded.payload_json,
      expires_at = excluded.expires_at,
      created_at = excluded.created_at
  `);
  const select = db.prepare<string>(`
    select interaction_id, bridge_session_id, channel, chat_id, message_id, kind,
      payload_json, expires_at, created_at
    from interaction_messages
    where interaction_id = ?
  `);

  return {
    insert(message: InteractionMessageInput): void {
      insert.run({
        ...message,
        payloadJson: JSON.stringify(message.payload),
      });
    },
    get(interactionId: string): InteractionMessageRecord | null {
      const row = select.get(interactionId) as InteractionMessageRow | undefined;
      return row ? mapInteractionMessage(row) : null;
    },
  };
}

function createUploadRepository(db: Database) {
  const insert = db.prepare(`
    insert into uploads (
      bridge_session_id, channel, channel_file_id, original_filename, mime_type,
      local_path, size_bytes, caption, created_at
    ) values (
      @sessionId, @channel, @channelFileId, @originalFilename, @mimeType,
      @localPath, @sizeBytes, @caption, @createdAt
    )
  `);
  const list = db.prepare<string>(`
    select id, bridge_session_id, channel, channel_file_id, original_filename,
      mime_type, local_path, size_bytes, caption, created_at
    from uploads
    where bridge_session_id = ?
    order by created_at asc, id asc
  `);

  return {
    insert(upload: UploadInput): number {
      const result = insert.run(upload);
      return Number(result.lastInsertRowid);
    },
    list(sessionId: string): UploadRecord[] {
      return (list.all(sessionId) as UploadRow[]).map(mapUpload);
    },
  };
}

function createAuditLogRepository(db: Database) {
  const insert = db.prepare(`
    insert into audit_logs (
      channel, chat_id, user_id, action, bridge_session_id, details_json, created_at
    ) values (
      @channel, @chatId, @userId, @action, @sessionId, @detailsJson, @createdAt
    )
  `);
  const listAll = db.prepare(`
    select id, channel, chat_id, user_id, action, bridge_session_id, details_json, created_at
    from audit_logs
    order by created_at asc, id asc
  `);
  const listByUser = db.prepare<string>(`
    select id, channel, chat_id, user_id, action, bridge_session_id, details_json, created_at
    from audit_logs
    where user_id = ?
    order by created_at asc, id asc
  `);

  return {
    insert(log: AuditLogInput): number {
      const result = insert.run({
        ...log,
        detailsJson: JSON.stringify(log.details),
      });
      return Number(result.lastInsertRowid);
    },
    list(filter: { userId?: string } = {}): AuditLogRecord[] {
      const rows =
        filter.userId === undefined
          ? (listAll.all() as AuditLogRow[])
          : (listByUser.all(filter.userId) as AuditLogRow[]);
      return rows.map(mapAuditLog);
    },
  };
}

function sessionSelectSql(whereClause: string): string {
  return `
    select
      s.id,
      s.channel,
      s.channel_chat_id,
      s.channel_user_id,
      s.tool,
      s.cwd,
      s.status,
      s.active_pty_pid,
      s.created_at,
      s.updated_at,
      s.last_active_at,
      s.title,
      s.is_active,
      n.tool as native_tool,
      n.native_id,
      n.resume_command_json,
      n.discovered_at,
      n.confidence
    from bridge_sessions s
    left join native_sessions n on n.bridge_session_id = s.id
    ${whereClause}
  `;
}

function mapSession(row: BridgeSessionRow): BridgeSessionRecord {
  return {
    id: row.id,
    channel: row.channel,
    channelChatId: row.channel_chat_id,
    channelUserId: row.channel_user_id,
    tool: row.tool,
    cwd: row.cwd,
    status: row.status,
    activePtyPid: row.active_pty_pid,
    native:
      row.native_tool && row.resume_command_json && row.confidence
        ? {
            tool: row.native_tool,
            id: row.native_id,
            resumeCommand: parseJson<string[]>(row.resume_command_json),
            discoveredAt: row.discovered_at,
            confidence: row.confidence,
          }
        : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastActiveAt: row.last_active_at,
    title: row.title,
    isActive: row.is_active === 1,
  };
}

function mapRunnerEvent(row: RunnerEventRow): RunnerEventRecord {
  return {
    id: row.id,
    sessionId: row.bridge_session_id,
    type: row.type,
    sequence: row.sequence,
    payload: parseJson<JsonValue>(row.payload_json),
    createdAt: row.created_at,
  };
}

function mapInteractionMessage(row: InteractionMessageRow): InteractionMessageRecord {
  return {
    interactionId: row.interaction_id,
    sessionId: row.bridge_session_id,
    channel: row.channel,
    chatId: row.chat_id,
    messageId: row.message_id,
    kind: row.kind,
    payload: parseJson<JsonValue>(row.payload_json),
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  };
}

function mapUpload(row: UploadRow): UploadRecord {
  return {
    id: row.id,
    sessionId: row.bridge_session_id,
    channel: row.channel,
    channelFileId: row.channel_file_id,
    originalFilename: row.original_filename,
    mimeType: row.mime_type,
    localPath: row.local_path,
    sizeBytes: row.size_bytes,
    caption: row.caption,
    createdAt: row.created_at,
  };
}

function mapAuditLog(row: AuditLogRow): AuditLogRecord {
  return {
    id: row.id,
    channel: row.channel,
    chatId: row.chat_id,
    userId: row.user_id,
    action: row.action,
    sessionId: row.bridge_session_id,
    details: parseJson<JsonValue>(row.details_json),
    createdAt: row.created_at,
  };
}

function booleanToSql(value: boolean): 0 | 1 {
  return value ? 1 : 0;
}

function parseJson<T>(raw: string): T {
  return JSON.parse(raw) as T;
}
