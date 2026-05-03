import type { ChannelButton, ChannelButtonRow } from "../channel/types.js";
import type { InteractionCallbackAction } from "./callbackData.js";
import { encodeCallbackData } from "./callbackData.js";

interface ButtonSpec {
  readonly label: string;
  readonly action: InteractionCallbackAction;
}

const controlPadRows: readonly (readonly ButtonSpec[])[] = [
  [{ label: "Up", action: "up" }],
  [
    { label: "Left", action: "left" },
    { label: "Enter", action: "enter" },
    { label: "Right", action: "right" },
  ],
  [{ label: "Down", action: "down" }],
  [
    { label: "Esc", action: "esc" },
    { label: "Tab", action: "tab" },
    { label: "Backspace", action: "backspace" },
  ],
  [
    { label: "Ctrl-C", action: "ctrl-c" },
    { label: "Ctrl-D", action: "ctrl-d" },
  ],
  [
    { label: "Yes", action: "yes" },
    { label: "No", action: "no" },
    { label: "Cancel", action: "cancel" },
  ],
  [
    { label: "Refresh", action: "refresh" },
    { label: "Hide Keyboard", action: "hide-keyboard" },
  ],
];

const confirmationRows: readonly (readonly ButtonSpec[])[] = [
  [
    { label: "Yes", action: "yes" },
    { label: "No", action: "no" },
    { label: "Cancel", action: "cancel" },
  ],
];

export function buildControlPadKeyboard(interactionId: string): ChannelButtonRow[] {
  return buildKeyboard(interactionId, controlPadRows);
}

export function buildConfirmationKeyboard(interactionId: string): ChannelButtonRow[] {
  return buildKeyboard(interactionId, confirmationRows);
}

function buildKeyboard(
  interactionId: string,
  rows: readonly (readonly ButtonSpec[])[]
): ChannelButtonRow[] {
  return rows.map((row) => ({
    buttons: row.map((button): ChannelButton => ({
      label: button.label,
      value: encodeCallbackData({
        interactionId,
        action: button.action,
      }),
    })),
  }));
}
