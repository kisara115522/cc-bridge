import { describe, expect, it } from "vitest";

import { chunkTerminalOutput } from "../src/terminal/chunker.js";

describe("terminal output chunking", () => {
  it("strips ANSI escape codes before measuring and returning chunks", () => {
    const chunks = chunkTerminalOutput("\x1b[32mgreen\x1b[0m plain", { maxChars: 100 });

    expect(chunks).toEqual(["green plain"]);
  });

  it("splits output below the configured Telegram character limit", () => {
    const chunks = chunkTerminalOutput("alpha beta gamma delta", { maxChars: 10 });

    expect(chunks).toEqual(["alpha beta", "gamma", "delta"]);
    expect(chunks.every((chunk) => chunk.length <= 10)).toBe(true);
  });

  it("preserves fenced code block readability across chunk boundaries", () => {
    const output = ["```ts", "const alpha = 1;", "const beta = 2;", "```"].join("\n");
    const chunks = chunkTerminalOutput(output, { maxChars: 28 });

    expect(chunks).toEqual(["```ts\nconst alpha = 1;\n```", "```ts\nconst beta = 2;\n```"]);
    expect(chunks.every((chunk) => chunk.length <= 28)).toBe(true);
  });

  it("hard-splits long unbroken text when no readable boundary fits", () => {
    const chunks = chunkTerminalOutput("abcdefghijklmnop", { maxChars: 6 });

    expect(chunks).toEqual(["abcdef", "ghijkl", "mnop"]);
  });

  it("strips box-drawing border lines", () => {
    const output = [
      "╭──────────────────────────────────╮",
      "│ Tips for getting started │",
      "╰──────────────────────────────────╯",
      "Hello world"
    ].join("\n");
    const chunks = chunkTerminalOutput(output, { maxChars: 200 });

    expect(chunks).toEqual(["Hello world"]);
  });

  it("strips spinner and thinking status lines", () => {
    const output = [
      "✻ Tomfoolering… (0s)",
      "thinking with xhigh effort",
      "✻✽✶✳✢·",
      "The actual response text"
    ].join("\n");
    const chunks = chunkTerminalOutput(output, { maxChars: 200 });

    expect(chunks).toEqual(["The actual response text"]);
  });

  it("strips status bar and token count lines", () => {
    const output = [
      "xxx@XXXdeMacBook-Pro ~/Code/workSpace | mimo-v2.5-pro[1m] 22:08:50",
      "0tokens",
      "↓ 1 tokens",
      "Actual content here"
    ].join("\n");
    const chunks = chunkTerminalOutput(output, { maxChars: 200 });

    expect(chunks).toEqual(["Actual content here"]);
  });

  it("strips keyboard shortcut hint lines", () => {
    const output = [
      "⏵⏵ don't ask on (shift+tab to cycle)",
      "Real message"
    ].join("\n");
    const chunks = chunkTerminalOutput(output, { maxChars: 200 });

    expect(chunks).toEqual(["Real message"]);
  });

  it("cleans a realistic Claude Code TUI dump", () => {
    const output = [
      "╭───ClaudeCodev2.1.126──────────────────────────────────────────────────────────────────────────╮",
      "││Tipsforgettingstarted│",
      "╰──────────────────────────────────────────────────────────────────────────────────────────────────╯",
      "",
      "✻ Tomfoolering… (0s)",
      "thinking with xhigh effort",
      "thinking with xhigh effort",
      "✻✽✶✳✢·",
      "",
      "∴ Thinking…",
      "The user said \"hi\". Let me check if any skill applies.",
      "",
      "✻Tomfolering… (5s · ↓ 1 tokens · thinking with xhigh effort)",
      "────────────────────────────────────────────────────────────────────────────────────────────────────",
      "xxx@XXXdeMacBook-Pro ~/Code/workSpace |mimo-v2.5-pro[1m] 22:08:500tokens",
      "⏵⏵don'taskon (shift+tabtocycle)",
      "",
      "你好！有什么我可以帮你的吗？",
      "",
      "Moonwalking… (running stop hooks… 0/2  9s  ↓ 16 tokens  thought for 2s)",
      "129",
      "Churned for 9s"
    ].join("\n");
    const chunks = chunkTerminalOutput(output, { maxChars: 500 });

    expect(chunks.length).toBeGreaterThan(0);
    const text = chunks.join("\n");
    expect(text).toContain("The user said");
    expect(text).toContain("你好！有什么我可以帮你的吗？");
    expect(text).not.toContain("Tomfoolering");
    expect(text).not.toContain("Moonwalking");
    expect(text).not.toContain("Churned");
    expect(text).not.toContain("╭");
    expect(text).not.toContain("tokens");
    expect(text).not.toContain("shift+tab");
    expect(text).not.toContain("thought for");
  });

  it("filters stuttered TUI redraw fragments", () => {
    const output = [
      "St",
      "Sta",
      "Start",
      "Starti",
      "Starting",
      "Starting MCP",
      "Starting MCP servers (1/4): context7, github, openaiDeveloperDocs",
      "",
      "Hello from the agent"
    ].join("\n");
    const chunks = chunkTerminalOutput(output, { maxChars: 500 });
    const text = chunks.join("\n");

    expect(text).toContain("Hello from the agent");
    // The stuttered "Starting MCP servers" line should be kept as it's the complete version,
    // but individual stuttered fragments should be filtered
    expect(text).not.toContain("StStaStart");
  });

  it("returns empty array when only TUI artifacts remain", () => {
    const output = [
      "╭───╮",
      "│ │",
      "╰───╯",
      "✻✽✶",
      "thinking with xhigh effort"
    ].join("\n");
    const chunks = chunkTerminalOutput(output, { maxChars: 200 });

    expect(chunks).toEqual([]);
  });
});
