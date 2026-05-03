import { describe, expect, it } from "vitest";

import { keyControlNames, keySequenceForControl } from "../src/runner/keys.js";

describe("runner key controls", () => {
  it("maps Telegram terminal controls to PTY input sequences", () => {
    expect(Object.fromEntries(keyControlNames.map((name) => [name, keySequenceForControl(name)]))).toEqual({
      up: "\x1b[A",
      down: "\x1b[B",
      left: "\x1b[D",
      right: "\x1b[C",
      enter: "\r",
      esc: "\x1b",
      tab: "\t",
      backspace: "\x7f",
      "ctrl-c": "\x03",
      "ctrl-d": "\x04",
      yes: "y\r",
      no: "n\r",
      cancel: "\x03",
    });
  });

  it("rejects unknown controls instead of sending raw callback data", () => {
    expect(() => keySequenceForControl("rm -rf" as never)).toThrow(/Unknown terminal control/);
  });
});
