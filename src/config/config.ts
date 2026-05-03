import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, isAbsolute, normalize, resolve } from "node:path";

import YAML from "yaml";
import { z } from "zod";

type StringRecord = Record<string, string | undefined>;

export interface BridgeConfig {
  telegram: {
    botToken: string;
    allowedUserIds: string[];
    allowedChatIds: string[];
    polling: boolean;
  };
  security: {
    allowAllUsers: boolean;
    allowedCwds: string[];
    defaultCwd: string;
  };
  tools: {
    codex: ToolConfig;
    claude: ToolConfig;
  };
  runtime: {
    stateDir: string;
    idleTimeoutMinutes: number;
    outputFlushMs: number;
    maxTelegramMessageChars: number;
    ptyCols: number;
    ptyRows: number;
  };
}

export interface ToolConfig {
  command: string;
  args: string[];
}

export interface LoadConfigOptions {
  configFilePath?: string;
  env?: StringRecord;
  homeDir?: string;
  overrides?: PartialDeep<BridgeConfig>;
}

type PartialDeep<T> = {
  [K in keyof T]?: T[K] extends Array<infer U>
    ? U[]
    : T[K] extends object
      ? PartialDeep<T[K]>
      : T[K];
};

const schema = z.object({
  telegram: z.object({
    botToken: z.string().min(1),
    allowedUserIds: z.array(z.string()),
    allowedChatIds: z.array(z.string()),
    polling: z.boolean()
  }),
  security: z.object({
    allowAllUsers: z.boolean(),
    allowedCwds: z.array(z.string()).min(1),
    defaultCwd: z.string().min(1)
  }),
  tools: z.object({
    codex: z.object({
      command: z.string().min(1),
      args: z.array(z.string())
    }),
    claude: z.object({
      command: z.string().min(1),
      args: z.array(z.string())
    })
  }),
  runtime: z.object({
    stateDir: z.string().min(1),
    idleTimeoutMinutes: z.number().int().positive(),
    outputFlushMs: z.number().int().positive(),
    maxTelegramMessageChars: z.number().int().min(100).max(4096),
    ptyCols: z.number().int().min(20),
    ptyRows: z.number().int().min(5)
  })
});

export async function loadConfig(options: LoadConfigOptions = {}): Promise<BridgeConfig> {
  const env = options.env ?? process.env;
  const home = options.homeDir ?? homedir();
  const fileConfig = await loadConfigFile(options.configFilePath);
  const envConfig = configFromEnv(env);
  const merged = mergeDeep(
    defaultConfig(home) as unknown as Record<string, unknown>,
    fileConfig as Record<string, unknown>,
    envConfig as Record<string, unknown>,
    (options.overrides ?? {}) as Record<string, unknown>
  );
  const normalized = normalizeConfig(merged as unknown as BridgeConfig, home);
  const parsed = schema.parse(normalized);

  if (!parsed.security.allowAllUsers && parsed.telegram.allowedUserIds.length === 0) {
    throw new Error("TELEGRAM_ALLOWED_USER_IDS is required unless CC_BRIDGE_ALLOW_ALL_USERS=true");
  }

  return parsed;
}

function defaultConfig(home: string): BridgeConfig {
  return {
    telegram: {
      botToken: "",
      allowedUserIds: [],
      allowedChatIds: [],
      polling: true
    },
    security: {
      allowAllUsers: false,
      allowedCwds: [expandPath("~/Code", home)],
      defaultCwd: expandPath("~/Code", home)
    },
    tools: {
      codex: {
        command: "/opt/homebrew/bin/codex",
        args: ["--no-alt-screen"]
      },
      claude: {
        command: "/opt/homebrew/bin/claude",
        args: []
      }
    },
    runtime: {
      stateDir: expandPath("~/.cc-bridge", home),
      idleTimeoutMinutes: 120,
      outputFlushMs: 800,
      maxTelegramMessageChars: 3500,
      ptyCols: 100,
      ptyRows: 30
    }
  };
}

async function loadConfigFile(configFilePath?: string): Promise<PartialDeep<BridgeConfig>> {
  if (!configFilePath) {
    return {};
  }

  const raw = await readFile(configFilePath, "utf8");
  return (YAML.parse(raw) ?? {}) as PartialDeep<BridgeConfig>;
}

function configFromEnv(env: StringRecord): PartialDeep<BridgeConfig> {
  return {
    telegram: removeUndefined({
      botToken: env.TELEGRAM_BOT_TOKEN,
      allowedUserIds: parseList(env.TELEGRAM_ALLOWED_USER_IDS),
      allowedChatIds: parseList(env.TELEGRAM_ALLOWED_CHAT_IDS),
      polling: parseBoolean(env.TELEGRAM_POLLING)
    }),
    security: removeUndefined({
      allowAllUsers: parseBoolean(env.CC_BRIDGE_ALLOW_ALL_USERS),
      allowedCwds: parsePathList(env.CC_BRIDGE_ALLOWED_CWDS),
      defaultCwd: env.CC_BRIDGE_DEFAULT_CWD
    }),
    tools: {
      codex: removeUndefined({
        command: env.CODEX_COMMAND,
        args: parseArgs(env.CODEX_ARGS)
      }),
      claude: removeUndefined({
        command: env.CLAUDE_COMMAND,
        args: parseArgs(env.CLAUDE_ARGS)
      })
    },
    runtime: removeUndefined({
      stateDir: env.CC_BRIDGE_STATE_DIR,
      idleTimeoutMinutes: parseNumber(env.CC_BRIDGE_IDLE_TIMEOUT_MINUTES),
      outputFlushMs: parseNumber(env.CC_BRIDGE_OUTPUT_FLUSH_MS),
      maxTelegramMessageChars: parseNumber(env.CC_BRIDGE_MAX_TELEGRAM_MESSAGE_CHARS),
      ptyCols: parseNumber(env.CC_BRIDGE_PTY_COLS),
      ptyRows: parseNumber(env.CC_BRIDGE_PTY_ROWS)
    })
  };
}

function normalizeConfig(config: BridgeConfig, home: string): BridgeConfig {
  return {
    ...config,
    security: {
      ...config.security,
      allowedCwds: config.security.allowedCwds.map((path) => expandPath(path, home)),
      defaultCwd: expandPath(config.security.defaultCwd, home)
    },
    runtime: {
      ...config.runtime,
      stateDir: expandPath(config.runtime.stateDir, home)
    }
  };
}

function expandPath(path: string, home: string): string {
  const expanded = path === "~" ? home : path.startsWith("~/") ? `${home}${path.slice(1)}` : path;
  return normalize(isAbsolute(expanded) ? expanded : resolve(expanded));
}

function parseList(value: string | undefined): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parsePathList(value: string | undefined): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  const separator = value.includes(",") ? "," : delimiter;
  return value
    .split(separator)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseBoolean(value: string | undefined): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function parseNumber(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === "") {
    return undefined;
  }
  return Number(value);
}

function parseArgs(value: string | undefined): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return [];
  }
  if (trimmed.startsWith("[")) {
    return z.array(z.string()).parse(JSON.parse(trimmed));
  }
  return trimmed.split(/\s+/);
}

function removeUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}

function mergeDeep(...values: Array<Record<string, unknown>>): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const value of values) {
    for (const [key, entry] of Object.entries(value)) {
      if (entry === undefined) {
        continue;
      }
      if (isPlainObject(entry) && isPlainObject(result[key])) {
        result[key] = mergeDeep(result[key] as Record<string, unknown>, entry);
      } else {
        result[key] = entry;
      }
    }
  }

  return result;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
