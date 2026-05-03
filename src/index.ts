#!/usr/bin/env node
import { Command } from "commander";

export function createProgram(): Command {
  const program = new Command();

  program
    .name("cc-bridge")
    .description("Telegram bridge for local Codex and Claude Code sessions.")
    .version("0.1.0");

  program.command("start").description("Start the bridge service.").action(() => {
    console.log("cc-bridge start is not wired yet.");
  });

  program.command("doctor").description("Check local bridge configuration.").action(() => {
    console.log("cc-bridge doctor is not wired yet.");
  });

  return program;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await createProgram().parseAsync(process.argv);
}
