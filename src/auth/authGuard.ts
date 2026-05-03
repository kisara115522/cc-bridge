import type { ChannelChat, ChannelName, ChannelUser } from "../channel/types.js";

export interface AuthGuardConfig {
  readonly allowedUserIds: readonly string[];
  readonly allowedChatIds?: readonly string[];
  readonly allowAllUsers?: boolean;
}

export interface AuthRequest {
  readonly channel: ChannelName;
  readonly chat: ChannelChat;
  readonly user: ChannelUser | null;
}

export interface AuthPrincipal {
  readonly channel: ChannelName;
  readonly chatId: string;
  readonly userId: string;
}

export type AuthDenyReason =
  | "missing_user"
  | "user_not_allowed"
  | "group_chat_requires_allowlist"
  | "chat_not_allowed";

export type AuthDecision =
  | {
      readonly allowed: true;
      readonly principal: AuthPrincipal;
    }
  | {
      readonly allowed: false;
      readonly reason: AuthDenyReason;
      readonly message: string;
    };

export interface AuthGuard {
  authorize(request: AuthRequest): AuthDecision;
}

export function createAuthGuard(config: AuthGuardConfig): AuthGuard {
  if (!config.allowAllUsers && config.allowedUserIds.length === 0) {
    throw new Error("allowedUserIds is required unless allowAllUsers is true");
  }

  const allowedUserIds = new Set(config.allowedUserIds);
  const allowedChatIds = config.allowedChatIds
    ? new Set(config.allowedChatIds)
    : null;

  return {
    authorize(request) {
      if (!request.user) {
        return deny("missing_user");
      }

      if (!config.allowAllUsers && !allowedUserIds.has(request.user.id)) {
        return deny("user_not_allowed");
      }

      if (isGroupChat(request.chat)) {
        if (!allowedChatIds) {
          return deny("group_chat_requires_allowlist");
        }

        if (!allowedChatIds.has(request.chat.id)) {
          return deny("chat_not_allowed");
        }
      }

      return {
        allowed: true,
        principal: {
          channel: request.channel,
          chatId: request.chat.id,
          userId: request.user.id,
        },
      };
    },
  };
}

function deny(reason: AuthDenyReason): AuthDecision {
  return {
    allowed: false,
    reason,
    message: "Unauthorized.",
  };
}

function isGroupChat(chat: ChannelChat): boolean {
  return chat.type !== "private";
}
