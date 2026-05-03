import type { Database } from "better-sqlite3";

const latestVersion = 1;

export function migrateDatabase(db: Database): void {
  db.pragma("foreign_keys = ON");

  const currentVersion = db.pragma("user_version", { simple: true }) as number;
  if (currentVersion > latestVersion) {
    throw new Error(`Unsupported database version ${currentVersion}`);
  }
  if (currentVersion === latestVersion) {
    return;
  }

  db.transaction(() => {
    if (currentVersion < 1) {
      migrateToVersion1(db);
      db.pragma("user_version = 1");
    }
  })();
}

function migrateToVersion1(db: Database): void {
  db.exec(`
    create table if not exists bridge_sessions (
      id text primary key,
      channel text not null,
      channel_chat_id text not null,
      channel_user_id text not null,
      tool text not null check (tool in ('codex', 'claude')),
      cwd text not null,
      status text not null,
      active_pty_pid integer,
      created_at text not null,
      updated_at text not null,
      last_active_at text not null,
      title text,
      is_active integer not null default 0 check (is_active in (0, 1))
    );

    create unique index if not exists bridge_sessions_one_active_principal
      on bridge_sessions(channel, channel_chat_id, channel_user_id)
      where is_active = 1;

    create index if not exists bridge_sessions_principal_updated
      on bridge_sessions(channel, channel_chat_id, channel_user_id, updated_at);

    create table if not exists native_sessions (
      bridge_session_id text primary key
        references bridge_sessions(id) on delete cascade,
      tool text not null check (tool in ('codex', 'claude')),
      native_id text,
      resume_command_json text not null,
      discovered_at text,
      confidence text not null
        check (confidence in ('explicit', 'discovered', 'last-resort', 'unknown'))
    );

    create table if not exists channel_messages (
      id integer primary key autoincrement,
      bridge_session_id text
        references bridge_sessions(id) on delete set null,
      channel text not null,
      chat_id text not null,
      user_id text,
      direction text not null check (direction in ('inbound', 'outbound')),
      message_id text not null,
      text text,
      payload_json text not null,
      created_at text not null
    );

    create index if not exists channel_messages_session_created
      on channel_messages(bridge_session_id, created_at);

    create table if not exists interaction_messages (
      interaction_id text primary key,
      bridge_session_id text not null
        references bridge_sessions(id) on delete cascade,
      channel text not null,
      chat_id text not null,
      message_id text not null,
      kind text not null,
      payload_json text not null,
      expires_at text,
      created_at text not null
    );

    create index if not exists interaction_messages_session_created
      on interaction_messages(bridge_session_id, created_at);

    create table if not exists runner_events (
      id integer primary key autoincrement,
      bridge_session_id text not null
        references bridge_sessions(id) on delete cascade,
      type text not null,
      sequence integer not null,
      payload_json text not null,
      created_at text not null,
      unique (bridge_session_id, sequence)
    );

    create index if not exists runner_events_session_sequence
      on runner_events(bridge_session_id, sequence);

    create table if not exists uploads (
      id integer primary key autoincrement,
      bridge_session_id text not null
        references bridge_sessions(id) on delete cascade,
      channel text not null,
      channel_file_id text not null,
      original_filename text,
      mime_type text,
      local_path text not null,
      size_bytes integer not null,
      caption text,
      created_at text not null
    );

    create index if not exists uploads_session_created
      on uploads(bridge_session_id, created_at);

    create table if not exists audit_logs (
      id integer primary key autoincrement,
      channel text not null,
      chat_id text,
      user_id text,
      action text not null,
      bridge_session_id text
        references bridge_sessions(id) on delete set null,
      details_json text not null,
      created_at text not null
    );

    create index if not exists audit_logs_created
      on audit_logs(created_at);

    create index if not exists audit_logs_user_created
      on audit_logs(user_id, created_at);
  `);
}
