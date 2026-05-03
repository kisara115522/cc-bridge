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
    expect(JSON.stringify(result)).not.toContain("secret-token");
  });
});
