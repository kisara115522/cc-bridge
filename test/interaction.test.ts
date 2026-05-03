import { describe, expect, it } from "vitest";

import {
  decodeCallbackData,
  encodeCallbackData,
} from "../src/interaction/callbackData.js";
import {
  buildConfirmationKeyboard,
  buildControlPadKeyboard,
} from "../src/interaction/keyboards.js";
import {
  callbackActionToPtyInput,
  expiredCallbackAnswer,
} from "../src/interaction/renderer.js";

describe("interaction callback data", () => {
  it("round-trips opaque callback data with interaction id and action", () => {
    const value = encodeCallbackData({
      interactionId: "interaction-123",
      action: "ctrl-c",
    });

    expect(value).not.toContain("interaction-123");
    expect(value).not.toContain("ctrl-c");
    expect(decodeCallbackData(value)).toEqual({
      interactionId: "interaction-123",
      action: "ctrl-c",
    });
  });

  it("rejects malformed or unsupported callback data", () => {
    expect(decodeCallbackData("interaction-123:ctrl-c")).toBeNull();
    expect(decodeCallbackData("")).toBeNull();

    const unsupported = encodeCallbackData({
      interactionId: "interaction-123",
      action: "ctrl-c",
    }).replace(/.$/, "x");

    expect(decodeCallbackData(unsupported)).toBeNull();
  });
});

describe("interaction keyboards", () => {
  it("builds a control pad keyboard with encoded callback values", () => {
    const keyboard = buildControlPadKeyboard("interaction-123");

    expect(keyboard.map((row) => row.buttons.map((button) => button.label))).toEqual([
      ["Up"],
      ["Left", "Enter", "Right"],
      ["Down"],
      ["Esc", "Tab", "Backspace"],
      ["Ctrl-C", "Ctrl-D"],
      ["Yes", "No", "Cancel"],
      ["Refresh", "Hide Keyboard"],
    ]);

    const actions = keyboard.flatMap((row) =>
      row.buttons.map((button) => decodeCallbackData(button.value)?.action)
    );

    expect(actions).toEqual([
      "up",
      "left",
      "enter",
      "right",
      "down",
      "esc",
      "tab",
      "backspace",
      "ctrl-c",
      "ctrl-d",
      "yes",
      "no",
      "cancel",
      "refresh",
      "hide-keyboard",
    ]);
  });

  it("builds a confirmation keyboard with yes no and cancel controls", () => {
    const keyboard = buildConfirmationKeyboard("interaction-123");

    expect(keyboard.map((row) => row.buttons.map((button) => button.label))).toEqual([
      ["Yes", "No", "Cancel"],
    ]);

    expect(
      keyboard[0]?.buttons.map((button) => decodeCallbackData(button.value))
    ).toEqual([
      { interactionId: "interaction-123", action: "yes" },
      { interactionId: "interaction-123", action: "no" },
      { interactionId: "interaction-123", action: "cancel" },
    ]);
  });
});

describe("interaction renderer", () => {
  it("renders an expired callback answer that points users back to live controls", () => {
    expect(expiredCallbackAnswer()).toEqual({
      text: "This keyboard expired. Use /keyboard or /status.",
      showAlert: false,
    });
  });

  it("maps terminal callback actions to PTY input and ignores UI-only actions", () => {
    expect(callbackActionToPtyInput("up")).toBe("\x1b[A");
    expect(callbackActionToPtyInput("enter")).toBe("\r");
    expect(callbackActionToPtyInput("ctrl-c")).toBe("\x03");
    expect(callbackActionToPtyInput("yes")).toBe("y\r");
    expect(callbackActionToPtyInput("no")).toBe("n\r");
    expect(callbackActionToPtyInput("cancel")).toBe("\x03");
    expect(callbackActionToPtyInput("refresh")).toBeNull();
    expect(callbackActionToPtyInput("hide-keyboard")).toBeNull();
  });
});
