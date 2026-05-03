import { describe, expect, it } from "vitest";

import { COMMAND_HELP } from "../src/commands/help.js";
import { parseCommand } from "../src/commands/parser.js";

describe("parseCommand", () => {
  it("parses bridge commands without arguments", () => {
    expect(parseCommand("/start")).toEqual({ kind: "start" });
    expect(parseCommand("/help")).toEqual({ kind: "help" });
    expect(parseCommand("/doctor")).toEqual({ kind: "doctor" });
    expect(parseCommand("/sessions")).toEqual({ kind: "sessions" });
    expect(parseCommand("/stop")).toEqual({ kind: "stop" });
    expect(parseCommand("/status")).toEqual({ kind: "status" });
    expect(parseCommand("/keyboard")).toEqual({ kind: "keyboard" });
    expect(parseCommand("/cwd")).toEqual({ kind: "cwd", value: null });
    expect(parseCommand("/files")).toEqual({ kind: "files" });
  });

  it("parses new session commands with optional cwd", () => {
    expect(parseCommand("/new codex")).toEqual({
      kind: "new",
      tool: "codex",
      cwd: null,
    });
    expect(parseCommand("/new claude /Users/xxx/Code/workSpace/cc-bridge")).toEqual({
      kind: "new",
      tool: "claude",
      cwd: "/Users/xxx/Code/workSpace/cc-bridge",
    });
    expect(parseCommand("/new codex project-alias")).toEqual({
      kind: "new",
      tool: "codex",
      cwd: "project-alias",
    });
  });

  it("parses session id commands", () => {
    expect(parseCommand("/switch bridge-123")).toEqual({
      kind: "switch",
      id: "bridge-123",
    });
    expect(parseCommand("/resume bridge-123")).toEqual({
      kind: "resume",
      id: "bridge-123",
    });
    expect(parseCommand("/fork bridge-123")).toEqual({
      kind: "fork",
      id: "bridge-123",
    });
  });

  it("preserves payload text for raw and send commands", () => {
    expect(parseCommand("/raw hello /world  ")).toEqual({
      kind: "raw",
      text: "hello /world  ",
    });
    expect(parseCommand("/send run npm test -- test/commands.test.ts")).toEqual({
      kind: "send",
      text: "run npm test -- test/commands.test.ts",
    });
  });

  it("parses cwd setter values", () => {
    expect(parseCommand("/cwd ~/Code/workSpace/cc-bridge")).toEqual({
      kind: "cwd",
      value: "~/Code/workSpace/cc-bridge",
    });
    expect(parseCommand("/cwd project alias with spaces")).toEqual({
      kind: "cwd",
      value: "project alias with spaces",
    });
  });

  it("forwards normal text as a send action", () => {
    expect(parseCommand("explain this file")).toEqual({
      kind: "forward",
      text: "explain this file",
    });
    expect(parseCommand("  keep my leading spaces")).toEqual({
      kind: "forward",
      text: "  keep my leading spaces",
    });
  });

  it("returns invalid command details for malformed commands", () => {
    expect(parseCommand("/new")).toEqual({
      kind: "invalid",
      reason: "Usage: /new codex|claude [cwd]",
    });
    expect(parseCommand("/new gemini")).toEqual({
      kind: "invalid",
      reason: "Usage: /new codex|claude [cwd]",
    });
    expect(parseCommand("/switch")).toEqual({
      kind: "invalid",
      reason: "Usage: /switch <id>",
    });
    expect(parseCommand("/raw")).toEqual({
      kind: "invalid",
      reason: "Usage: /raw <text>",
    });
    expect(parseCommand("/unknown value")).toEqual({
      kind: "invalid",
      reason: "Unknown command: /unknown",
    });
  });
});

describe("COMMAND_HELP", () => {
  it("documents supported Telegram bridge commands", () => {
    expect(COMMAND_HELP).toContain("/new codex [cwd]");
    expect(COMMAND_HELP).toContain("/new claude [cwd]");
    expect(COMMAND_HELP).toContain("/switch <id>");
    expect(COMMAND_HELP).toContain("/raw <text>");
    expect(COMMAND_HELP).toContain("normal text");
  });
});
