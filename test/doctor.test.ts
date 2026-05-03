import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runDoctor } from "../src/doctor.js";

const tempDirs: string[] = [];

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

describe("runDoctor", () => {
  it("checks config, state directory, database, and local tool commands without leaking token", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cc-bridge-doctor-"));
    tempDirs.push(dir);
    const result = await runDoctor({
      env: {
        TELEGRAM_BOT_TOKEN: "secret-token",
        TELEGRAM_ALLOWED_USER_IDS: "user-1",
        CC_BRIDGE_STATE_DIR: dir,
        CODEX_COMMAND: process.execPath,
        CODEX_ARGS: "--version",
        CLAUDE_COMMAND: process.execPath,
        CLAUDE_ARGS: "--version"
      },
      skipTelegramNetwork: true
    });

    expect(result.ok).toBe(true);
    expect(result.checks.map((check) => check.name)).toContain("config");
    expect(result.checks.map((check) => check.name)).toContain("pty");
    expect(JSON.stringify(result)).not.toContain("secret-token");
  });

  it("reports Telegram network failures without crashing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cc-bridge-doctor-"));
    tempDirs.push(dir);
    const result = await runDoctor({
      env: {
        TELEGRAM_BOT_TOKEN: "secret-token",
        TELEGRAM_ALLOWED_USER_IDS: "user-1",
        CC_BRIDGE_STATE_DIR: dir,
        CODEX_COMMAND: process.execPath,
        CODEX_ARGS: "--version",
        CLAUDE_COMMAND: process.execPath,
        CLAUDE_ARGS: "--version"
      },
      fetchImpl: async () => {
        throw new TypeError("fetch failed");
      }
    });

    expect(result.ok).toBe(false);
    expect(result.checks.at(-1)).toEqual({
      name: "telegram",
      ok: false,
      message: "getMe failed: fetch failed"
    });
  });

  it("reports PTY spawn failures before the bridge is started", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cc-bridge-doctor-"));
    tempDirs.push(dir);
    const result = await runDoctor({
      env: {
        TELEGRAM_BOT_TOKEN: "secret-token",
        TELEGRAM_ALLOWED_USER_IDS: "user-1",
        CC_BRIDGE_STATE_DIR: dir,
        CODEX_COMMAND: process.execPath,
        CODEX_ARGS: "--version",
        CLAUDE_COMMAND: process.execPath,
        CLAUDE_ARGS: "--version"
      },
      skipTelegramNetwork: true,
      ptyRunner: {
        async start() {
          throw new Error("posix_spawnp failed.");
        }
      }
    });

    expect(result.ok).toBe(false);
    expect(result.checks).toContainEqual({
      name: "pty",
      ok: false,
      message: "posix_spawnp failed."
    });
  });
});
