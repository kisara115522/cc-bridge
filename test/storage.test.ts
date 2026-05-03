import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { openBridgeDatabase } from "../src/storage/database.js";
import {
  createStorageRepositories,
  type BridgeSessionRecord,
} from "../src/storage/repositories.js";

const tempDirs: string[] = [];
const openDatabases: ReturnType<typeof openBridgeDatabase>[] = [];

async function openTempStorage() {
  const dir = await mkdtemp(join(tmpdir(), "cc-bridge-storage-"));
  tempDirs.push(dir);
  const db = openBridgeDatabase(join(dir, "state", "cc-bridge.sqlite"));
  openDatabases.push(db);
  return {
    db,
    storage: createStorageRepositories(db),
  };
}

afterEach(async () => {
  for (const db of openDatabases.splice(0)) {
    db.close();
  }
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

describe("SQLite storage", () => {
  it("opens a database and runs migrations", async () => {
    const { db } = await openTempStorage();

    const tables = db
      .prepare(
        "select name from sqlite_master where type = 'table' and name not like 'sqlite_%' order by name"
      )
      .all() as Array<{ name: string }>;

    expect(tables.map((table) => table.name)).toEqual([
      "audit_logs",
      "bridge_sessions",
      "channel_messages",
      "interaction_messages",
      "native_sessions",
      "runner_events",
      "uploads",
    ]);
    expect(db.pragma("user_version", { simple: true })).toBe(1);
  });

  it("persists bridge sessions and finds the active session for a channel principal", async () => {
    const { storage } = await openTempStorage();

    storage.sessions.upsert({
      id: "session-1",
      channel: "telegram",
      channelChatId: "chat-1",
      channelUserId: "user-1",
      tool: "codex",
      cwd: "/workspace/project",
      status: "running",
      activePtyPid: 1234,
      native: {
        tool: "codex",
        id: "native-1",
        resumeCommand: ["codex", "resume", "native-1"],
        discoveredAt: "2026-05-03T10:00:00.000Z",
        confidence: "discovered",
      },
      createdAt: "2026-05-03T10:00:00.000Z",
      updatedAt: "2026-05-03T10:01:00.000Z",
      lastActiveAt: "2026-05-03T10:01:00.000Z",
      title: "Project work",
      isActive: true,
    });

    const byId = storage.sessions.get("session-1");
    const active = storage.sessions.getActive("telegram", "chat-1", "user-1");

    expect(byId).toEqual(active);
    expect(active).toMatchObject({
      id: "session-1",
      channel: "telegram",
      channelChatId: "chat-1",
      channelUserId: "user-1",
      tool: "codex",
      status: "running",
      activePtyPid: 1234,
      title: "Project work",
      isActive: true,
      native: {
        tool: "codex",
        id: "native-1",
        resumeCommand: ["codex", "resume", "native-1"],
        confidence: "discovered",
      },
    });
  });

  it("keeps only one active bridge session per channel chat user", async () => {
    const { storage } = await openTempStorage();

    storage.sessions.upsert(sessionFixture({ id: "old-session", isActive: true }));
    storage.sessions.upsert(
      sessionFixture({
        id: "new-session",
        tool: "claude",
        isActive: true,
        createdAt: "2026-05-03T10:05:00.000Z",
        updatedAt: "2026-05-03T10:05:00.000Z",
        lastActiveAt: "2026-05-03T10:05:00.000Z",
      })
    );

    expect(storage.sessions.get("old-session")?.isActive).toBe(false);
    expect(storage.sessions.getActive("telegram", "chat-1", "user-1")?.id).toBe("new-session");
  });

  it("lists sessions for a channel principal and can switch the active session", async () => {
    const { storage } = await openTempStorage();

    storage.sessions.upsert(sessionFixture({ id: "session-1", isActive: true }));
    storage.sessions.upsert(
      sessionFixture({
        id: "session-2",
        tool: "claude",
        isActive: false,
        createdAt: "2026-05-03T10:05:00.000Z",
        updatedAt: "2026-05-03T10:05:00.000Z",
        lastActiveAt: "2026-05-03T10:05:00.000Z",
      })
    );

    expect(storage.sessions.listForPrincipal("telegram", "chat-1", "user-1").map((session) => session.id)).toEqual([
      "session-2",
      "session-1",
    ]);

    storage.sessions.setActive("session-2");

    expect(storage.sessions.get("session-1")?.isActive).toBe(false);
    expect(storage.sessions.get("session-2")?.isActive).toBe(true);
    expect(storage.sessions.getActive("telegram", "chat-1", "user-1")?.id).toBe("session-2");
  });

  it("inserts and lists runner events in append order", async () => {
    const { storage } = await openTempStorage();
    storage.sessions.upsert(sessionFixture({ id: "session-1" }));

    storage.runnerEvents.insert({
      sessionId: "session-1",
      type: "output",
      sequence: 1,
      payload: { text: "hello" },
      createdAt: "2026-05-03T10:00:01.000Z",
    });
    storage.runnerEvents.insert({
      sessionId: "session-1",
      type: "exit",
      sequence: 2,
      payload: { code: 0, signal: null },
      createdAt: "2026-05-03T10:00:02.000Z",
    });

    expect(storage.runnerEvents.list("session-1")).toEqual([
      {
        id: 1,
        sessionId: "session-1",
        type: "output",
        sequence: 1,
        payload: { text: "hello" },
        createdAt: "2026-05-03T10:00:01.000Z",
      },
      {
        id: 2,
        sessionId: "session-1",
        type: "exit",
        sequence: 2,
        payload: { code: 0, signal: null },
        createdAt: "2026-05-03T10:00:02.000Z",
      },
    ]);
  });

  it("persists interaction messages by interaction id", async () => {
    const { storage } = await openTempStorage();
    storage.sessions.upsert(sessionFixture({ id: "session-1" }));

    storage.interactionMessages.insert({
      interactionId: "kbd-1",
      sessionId: "session-1",
      channel: "telegram",
      chatId: "chat-1",
      messageId: "message-1",
      kind: "keyboard",
      payload: { rows: [["up", "enter"]] },
      expiresAt: "2026-05-03T10:05:00.000Z",
      createdAt: "2026-05-03T10:00:00.000Z",
    });

    expect(storage.interactionMessages.get("kbd-1")).toEqual({
      interactionId: "kbd-1",
      sessionId: "session-1",
      channel: "telegram",
      chatId: "chat-1",
      messageId: "message-1",
      kind: "keyboard",
      payload: { rows: [["up", "enter"]] },
      expiresAt: "2026-05-03T10:05:00.000Z",
      createdAt: "2026-05-03T10:00:00.000Z",
    });
  });

  it("inserts and lists upload records for a session", async () => {
    const { storage } = await openTempStorage();
    storage.sessions.upsert(sessionFixture({ id: "session-1" }));

    storage.uploads.insert({
      sessionId: "session-1",
      channel: "telegram",
      channelFileId: "telegram-file-1",
      originalFilename: "notes.txt",
      mimeType: "text/plain",
      localPath: "/state/uploads/session-1/notes.txt",
      sizeBytes: 12,
      caption: "please inspect",
      createdAt: "2026-05-03T10:00:00.000Z",
    });

    expect(storage.uploads.list("session-1")).toEqual([
      {
        id: 1,
        sessionId: "session-1",
        channel: "telegram",
        channelFileId: "telegram-file-1",
        originalFilename: "notes.txt",
        mimeType: "text/plain",
        localPath: "/state/uploads/session-1/notes.txt",
        sizeBytes: 12,
        caption: "please inspect",
        createdAt: "2026-05-03T10:00:00.000Z",
      },
    ]);
  });

  it("inserts and lists audit logs", async () => {
    const { storage } = await openTempStorage();

    storage.auditLogs.insert({
      channel: "telegram",
      chatId: "chat-1",
      userId: "user-1",
      action: "auth.denied",
      sessionId: null,
      details: { reason: "user_not_allowed" },
      createdAt: "2026-05-03T10:00:00.000Z",
    });

    expect(storage.auditLogs.list({ userId: "user-1" })).toEqual([
      {
        id: 1,
        channel: "telegram",
        chatId: "chat-1",
        userId: "user-1",
        action: "auth.denied",
        sessionId: null,
        details: { reason: "user_not_allowed" },
        createdAt: "2026-05-03T10:00:00.000Z",
      },
    ]);
  });
});

function sessionFixture(overrides: Partial<BridgeSessionRecord> = {}): BridgeSessionRecord {
  return {
    id: "session-1",
    channel: "telegram",
    channelChatId: "chat-1",
    channelUserId: "user-1",
    tool: "codex",
    cwd: "/workspace/project",
    status: "running",
    activePtyPid: null,
    native: null,
    createdAt: "2026-05-03T10:00:00.000Z",
    updatedAt: "2026-05-03T10:00:00.000Z",
    lastActiveAt: "2026-05-03T10:00:00.000Z",
    title: null,
    isActive: false,
    ...overrides,
  };
}
