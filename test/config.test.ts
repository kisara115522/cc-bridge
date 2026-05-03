import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { loadConfig } from "../src/config/config.js";
import { redactConfig } from "../src/config/redact.js";

describe("loadConfig", () => {
  it("loads required Telegram settings from environment variables", async () => {
    const config = await loadConfig({
      env: {
        TELEGRAM_BOT_TOKEN: "123:secret",
        TELEGRAM_ALLOWED_USER_IDS: "42, 99",
        CC_BRIDGE_ALLOWED_CWDS: "~/Code,/tmp/project",
        CC_BRIDGE_DEFAULT_CWD: "~/Code"
      },
      homeDir: "/Users/example"
    });

    expect(config.telegram.botToken).toBe("123:secret");
    expect(config.telegram.allowedUserIds).toEqual(["42", "99"]);
    expect(config.security.allowedCwds).toEqual(["/Users/example/Code", "/tmp/project"]);
    expect(config.security.defaultCwd).toBe("/Users/example/Code");
  });

  it("rejects an empty allowlist unless allowAllUsers is explicit", async () => {
    await expect(
      loadConfig({
        env: {
          TELEGRAM_BOT_TOKEN: "123:secret"
        },
        homeDir: "/Users/example"
      })
    ).rejects.toThrow("TELEGRAM_ALLOWED_USER_IDS is required");
  });

  it("allows an empty allowlist when allowAllUsers is true", async () => {
    const config = await loadConfig({
      env: {
        TELEGRAM_BOT_TOKEN: "123:secret",
        CC_BRIDGE_ALLOW_ALL_USERS: "true"
      },
      homeDir: "/Users/example"
    });

    expect(config.security.allowAllUsers).toBe(true);
    expect(config.telegram.allowedUserIds).toEqual([]);
  });

  it("lets environment variables override a YAML config file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cc-bridge-config-"));
    const configPath = join(dir, "config.yaml");
    await writeFile(
      configPath,
      [
        "telegram:",
        "  botToken: file-token",
        "  allowedUserIds: ['1']",
        "security:",
        "  defaultCwd: ~/FromFile"
      ].join("\n")
    );

    const config = await loadConfig({
      configFilePath: configPath,
      env: {
        TELEGRAM_BOT_TOKEN: "env-token",
        TELEGRAM_ALLOWED_USER_IDS: "2",
        CC_BRIDGE_DEFAULT_CWD: "~/FromEnv"
      },
      homeDir: "/Users/example"
    });

    expect(config.telegram.botToken).toBe("env-token");
    expect(config.telegram.allowedUserIds).toEqual(["2"]);
    expect(config.security.defaultCwd).toBe("/Users/example/FromEnv");
  });
});

describe("redactConfig", () => {
  it("redacts sensitive values without mutating config", async () => {
    const config = await loadConfig({
      env: {
        TELEGRAM_BOT_TOKEN: "123:secret",
        TELEGRAM_ALLOWED_USER_IDS: "42"
      },
      homeDir: "/Users/example"
    });

    const redacted = redactConfig(config);

    expect(redacted.telegram.botToken).toBe("[redacted]");
    expect(config.telegram.botToken).toBe("123:secret");
  });
});
