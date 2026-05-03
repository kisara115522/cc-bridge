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
});
