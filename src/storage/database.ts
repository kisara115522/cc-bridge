import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import Database from "better-sqlite3";

import { migrateDatabase } from "./migrations.js";

export type BridgeDatabase = Database.Database;

export function openBridgeDatabase(databasePath: string): BridgeDatabase {
  mkdirSync(dirname(databasePath), { recursive: true });

  const db = new Database(databasePath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrateDatabase(db);

  return db;
}
