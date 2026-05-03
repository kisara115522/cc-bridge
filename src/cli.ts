import { join } from "node:path";

import { Command } from "commander";

import { createBridgeApp } from "./app/bridgeApp.js";
import { loadConfig } from "./config/config.js";
import { redactConfig } from "./config/redact.js";
import { runDoctor } from "./doctor.js";
import { createPtyRunner } from "./runner/ptyRunner.js";
import { openBridgeDatabase } from "./storage/database.js";
import { createStorageRepositories } from "./storage/repositories.js";
import { TelegramChannelAdapter } from "./telegram/telegramAdapter.js";

export function createProgram(): Command {
  const program = new Command();

  program
    .name("cc-bridge")
    .description("Telegram bridge for local Codex and Claude Code sessions.")
    .version("0.1.0")
    .option("-c, --config <path>", "Path to config YAML");

  program
    .command("start")
    .description("Start the bridge service.")
    .action(async () => {
      const config = await loadConfig({
        configFilePath: program.opts<{ config?: string }>().config
      });
      const db = openBridgeDatabase(join(config.runtime.stateDir, "cc-bridge.sqlite"));
      const storage = createStorageRepositories(db);
      const adapter = new TelegramChannelAdapter({
        token: config.telegram.botToken,
        polling: config.telegram.polling,
        downloadDir: join(config.runtime.stateDir, "telegram-downloads"),
        onPollingError: (error) => {
          const message = error instanceof Error ? error.message : String(error);
          console.error(`Telegram polling failed: ${message}; retrying`);
        },
        onUpdateError: (error) => {
          const message = error instanceof Error ? error.message : String(error);
          console.error(`Telegram update handling failed: ${message}`);
        }
      });
      const app = createBridgeApp({
        config,
        adapter,
        storage,
        runner: createPtyRunner()
      });

      await app.start();
      console.log("cc-bridge started");
    });

  program
    .command("doctor")
    .description("Check local bridge configuration.")
    .option("--skip-telegram-network", "Skip Telegram getMe network check")
    .action(async (options: { skipTelegramNetwork?: boolean }) => {
      const result = await runDoctor({
        configFilePath: program.opts<{ config?: string }>().config,
        skipTelegramNetwork: options.skipTelegramNetwork
      });
      console.log(JSON.stringify(result, null, 2));
      if (!result.ok) {
        process.exitCode = 1;
      }
    });

  program
    .command("config")
    .description("Print redacted configuration.")
    .action(async () => {
      const config = await loadConfig({
        configFilePath: program.opts<{ config?: string }>().config
      });
      console.log(JSON.stringify(redactConfig(config), null, 2));
    });

  return program;
}
