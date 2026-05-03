import { describe, expect, it } from "vitest";

import { createProgram } from "../src/index.js";

describe("CLI entry", () => {
  it("creates a cc-bridge command program", () => {
    const program = createProgram();

    expect(program.name()).toBe("cc-bridge");
  });
});
