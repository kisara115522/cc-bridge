import { keyControlNames, type KeyControlName } from "../runner/keys.js";

export type InteractionCallbackAction =
  | KeyControlName
  | "refresh"
  | "hide-keyboard";

export interface InteractionCallbackData {
  readonly interactionId: string;
  readonly action: InteractionCallbackAction;
}

const callbackPrefix = "ccbi1:";
const callbackActions = new Set<InteractionCallbackAction>([
  ...keyControlNames,
  "refresh",
  "hide-keyboard",
]);

export function encodeCallbackData(data: InteractionCallbackData): string {
  if (data.interactionId.length === 0) {
    throw new Error("Interaction id is required");
  }

  if (!callbackActions.has(data.action)) {
    throw new Error(`Unsupported interaction action: ${String(data.action)}`);
  }

  return `${callbackPrefix}${Buffer.from(
    JSON.stringify({
      i: data.interactionId,
      a: data.action,
    }),
    "utf8"
  ).toString("base64url")}`;
}

export function decodeCallbackData(value: string): InteractionCallbackData | null {
  if (!value.startsWith(callbackPrefix)) {
    return null;
  }

  try {
    const payload = JSON.parse(
      Buffer.from(value.slice(callbackPrefix.length), "base64url").toString("utf8")
    ) as unknown;

    if (!isCallbackPayload(payload)) {
      return null;
    }

    return {
      interactionId: payload.i,
      action: payload.a,
    };
  } catch {
    return null;
  }
}

function isCallbackPayload(
  payload: unknown
): payload is { readonly i: string; readonly a: InteractionCallbackAction } {
  if (typeof payload !== "object" || payload === null) {
    return false;
  }

  const candidate = payload as { readonly i?: unknown; readonly a?: unknown };
  return (
    typeof candidate.i === "string" &&
    candidate.i.length > 0 &&
    typeof candidate.a === "string" &&
    callbackActions.has(candidate.a as InteractionCallbackAction)
  );
}
