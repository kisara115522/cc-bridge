import { readFile, stat } from "node:fs/promises";
import { normalize } from "node:path";

import fg from "fast-glob";

import type { NativeSessionRef } from "./nativeSession.js";

export interface DiscoverCodexSessionOptions {
  sessionsRoot: string;
  cwd: string;
  startedAfter?: Date;
}

export async function discoverCodexSession(
  options: DiscoverCodexSessionOptions
): Promise<NativeSessionRef> {
  const files = await findRolloutFiles(options.sessionsRoot, options.startedAfter);
  const targetCwd = normalize(options.cwd);

  for (const file of files) {
    const candidate = await readCodexRollout(file, targetCwd);

    if (candidate) {
      return {
        tool: "codex",
        confidence: "discovered",
        sessionId: candidate
      };
    }
  }

  return {
    tool: "codex",
    confidence: "unknown"
  };
}

async function findRolloutFiles(sessionsRoot: string, startedAfter?: Date): Promise<string[]> {
  const files = await fg("**/rollout-*.jsonl", {
    cwd: sessionsRoot,
    absolute: true,
    onlyFiles: true
  });

  const withStats = await Promise.all(
    files.map(async (file) => ({
      file,
      stats: await stat(file)
    }))
  );
  const minTime = startedAfter?.getTime();

  return withStats
    .filter(({ stats }) => minTime === undefined || stats.mtimeMs >= minTime)
    .sort((left, right) => right.stats.mtimeMs - left.stats.mtimeMs)
    .map(({ file }) => file);
}

async function readCodexRollout(file: string, targetCwd: string): Promise<string | null> {
  const raw = await readFile(file, "utf8");
  let sessionId: string | null = null;
  let seenCwd: string | null = null;

  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }

    const parsed = parseJsonLine(line);
    if (!parsed) {
      continue;
    }

    sessionId ??= extractSessionId(parsed);
    seenCwd ??= extractCwd(parsed);
  }

  if (!sessionId) {
    return null;
  }

  if (seenCwd && normalize(seenCwd) !== targetCwd) {
    return null;
  }

  return sessionId;
}

function parseJsonLine(line: string): unknown | null {
  try {
    return JSON.parse(line) as unknown;
  } catch {
    return null;
  }
}

function extractSessionId(value: unknown): string | null {
  if (!isRecord(value)) {
    return null;
  }

  if (value.type !== "session_meta") {
    return null;
  }

  const payload = value.payload;
  if (!isRecord(payload)) {
    return null;
  }

  const id = payload.id;
  return typeof id === "string" && id.length > 0 ? id : null;
}

function extractCwd(value: unknown): string | null {
  if (!isRecord(value)) {
    return null;
  }

  if (typeof value.cwd === "string" && value.cwd.length > 0) {
    return value.cwd;
  }

  const payload = value.payload;
  if (isRecord(payload) && typeof payload.cwd === "string" && payload.cwd.length > 0) {
    return payload.cwd;
  }

  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
