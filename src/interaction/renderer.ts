import type { InteractionAnswer } from "../channel/types.js";
import { keySequenceForControl, type KeyControlName } from "../runner/keys.js";
import type { InteractionCallbackAction } from "./callbackData.js";

const uiOnlyActions = new Set<InteractionCallbackAction>([
  "refresh",
  "hide-keyboard",
]);

export function expiredCallbackAnswer(): InteractionAnswer {
  return {
    text: "This keyboard expired. Use /keyboard or /status.",
    showAlert: false,
  };
}

export function callbackActionToPtyInput(
  action: InteractionCallbackAction
): string | null {
  if (uiOnlyActions.has(action)) {
    return null;
  }

  return keySequenceForControl(action as KeyControlName);
}
