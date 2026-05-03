import { access, mkdir } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import type { BridgeConfig, LoadConfigOptions } from "./config/config.js";
import { loadConfig } from "./config/config.js";
import { redactConfig } from "./config/redact.js";
import { openBridgeDatabase } from "./storage/database.js";

export interface DoctorOptions extends LoadConfigOptions {
  readonly skipTelegramNetwork?: boolean;
}

export interface DoctorCheck {
  readonly name: string;
  readonly ok: boolean;
  readonly message: string;
}

export interface DoctorResult {
  readonly ok: boolean;
  readonly checks: DoctorCheck[];
  readonly redactedConfig?: BridgeConfig;
}

export async function runDoctor(options: DoctorOptions = {}): Promise<DoctorResult> {
  const checks: DoctorCheck[] = [];
  let config: BridgeConfig;

  try {
    config = await loadConfig(options);
    checks.push({ name: "config", ok: true, message: "configuration loaded" });
  } catch (error) {
    return {
      ok: false,
      checks: [
        {
          name: "config",
          ok: false,
          message: error instanceof Error ? error.message : String(error)
        }
      ]
    };
  }

  checks.push(await checkStateDir(config.runtime.stateDir));
  checks.push(checkDatabase(config.runtime.stateDir));
  checks.push(checkCommand("codex", config.tools.codex.command));
  checks.push(checkCommand("claude", config.tools.claude.command));

  if (options.skipTelegramNetwork) {
    checks.push({ name: "telegram", ok: true, message: "network check skipped" });
  } else {
    checks.push(await checkTelegram(config.telegram.botToken));
  }

  return {
    ok: checks.every((check) => check.ok),
    checks,
    redactedConfig: redactConfig(config)
  };
}

async function checkStateDir(stateDir: string): Promise<DoctorCheck> {
  try {
    await mkdir(stateDir, { recursive: true });
    await access(stateDir, constants.R_OK | constants.W_OK);
    return { name: "stateDir", ok: true, message: stateDir };
  } catch (error) {
    return {
      name: "stateDir",
      ok: false,
      message: error instanceof Error ? error.message : String(error)
    };
  }
}

function checkDatabase(stateDir: string): DoctorCheck {
  try {
    const db = openBridgeDatabase(join(stateDir, "doctor.sqlite"));
    db.close();
    return { name: "database", ok: true, message: "sqlite open/migrate ok" };
  } catch (error) {
    return {
      name: "database",
      ok: false,
      message: error instanceof Error ? error.message : String(error)
    };
  }
}

function checkCommand(name: string, command: string): DoctorCheck {
  const result = spawnSync(command, ["--version"], {
    encoding: "utf8",
    timeout: 5000
  });

  if (result.error) {
    return { name, ok: false, message: result.error.message };
  }
  if (result.status !== 0) {
    return {
      name,
      ok: false,
      message: result.stderr.trim() || `exited with ${result.status}`
    };
  }
  return { name, ok: true, message: result.stdout.trim() || "ok" };
}

async function checkTelegram(token: string): Promise<DoctorCheck> {
  const response = await fetch(`https://api.telegram.org/bot${token}/getMe`);
  if (!response.ok) {
    return { name: "telegram", ok: false, message: `getMe failed: ${response.status}` };
  }
  return { name: "telegram", ok: true, message: "getMe ok" };
}
