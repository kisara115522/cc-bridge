import { describe, expect, it } from "vitest";

import { createAuthGuard } from "../src/auth/authGuard.js";
import type {
  ChannelAdapter,
  ChannelCapabilities,
  ChannelHandlers,
  ChannelName,
} from "../src/channel/types.js";

describe("channel contracts", () => {
  it("define a channel-neutral adapter contract", async () => {
    const capabilities: ChannelCapabilities = {
      inlineButtons: true,
      messageEditing: true,
      fileDownload: true,
      typingIndicator: true,
      ephemeralInteractionAnswer: true,
      alertInteractionAnswer: true,
    };

    const adapter: ChannelAdapter = {
      name: "test" satisfies ChannelName,
      capabilities,
      async start(_handlers: ChannelHandlers) {},
      async stop() {},
      async sendMessage(target, message) {
        return {
          channel: target.channel,
          chatId: target.chatId,
          messageId: `${message.text.length}`,
        };
      },
      async editMessage() {},
      async answerInteraction() {},
      async downloadAttachment(attachment) {
        return {
          attachmentId: attachment.id,
          filename: attachment.filename,
          mimeType: attachment.mimeType,
          data: new Uint8Array(),
        };
      },
    };

    const sent = await adapter.sendMessage(
      { channel: "test", chatId: "chat-1" },
      { text: "hello" }
    );

    expect(adapter.capabilities.inlineButtons).toBe(true);
    expect(sent).toEqual({
      channel: "test",
      chatId: "chat-1",
      messageId: "5",
    });
  });
});

describe("createAuthGuard", () => {
  it("allows configured users in private chats", () => {
    const guard = createAuthGuard({
      allowedUserIds: ["42"],
    });

    expect(
      guard.authorize({
        channel: "telegram",
        chat: { id: "42", type: "private" },
        user: { id: "42" },
      })
    ).toEqual({
      allowed: true,
      principal: {
        channel: "telegram",
        chatId: "42",
        userId: "42",
      },
    });
  });

  it("denies users outside the allowed user ID list", () => {
    const guard = createAuthGuard({
      allowedUserIds: ["42"],
    });

    expect(
      guard.authorize({
        channel: "telegram",
        chat: { id: "99", type: "private" },
        user: { id: "99" },
      })
    ).toEqual({
      allowed: false,
      reason: "user_not_allowed",
      message: "Unauthorized.",
    });
  });

  it("rejects an empty user allowlist unless allowAllUsers is explicit", () => {
    expect(() =>
      createAuthGuard({
        allowedUserIds: [],
      })
    ).toThrow("allowedUserIds is required unless allowAllUsers is true");

    const guard = createAuthGuard({
      allowedUserIds: [],
      allowAllUsers: true,
    });

    expect(
      guard.authorize({
        channel: "telegram",
        chat: { id: "99", type: "private" },
        user: { id: "99" },
      })
    ).toEqual({
      allowed: true,
      principal: {
        channel: "telegram",
        chatId: "99",
        userId: "99",
      },
    });
  });

  it("enforces the group chat allowlist when configured", () => {
    const guard = createAuthGuard({
      allowedUserIds: ["42"],
      allowedChatIds: ["group-1"],
    });

    expect(
      guard.authorize({
        channel: "telegram",
        chat: { id: "group-1", type: "group" },
        user: { id: "42" },
      })
    ).toEqual({
      allowed: true,
      principal: {
        channel: "telegram",
        chatId: "group-1",
        userId: "42",
      },
    });

    expect(
      guard.authorize({
        channel: "telegram",
        chat: { id: "group-2", type: "group" },
        user: { id: "42" },
      })
    ).toEqual({
      allowed: false,
      reason: "chat_not_allowed",
      message: "Unauthorized.",
    });
  });

  it("requires a group chat allowlist for group chat use", () => {
    const guard = createAuthGuard({
      allowedUserIds: ["42"],
    });

    expect(
      guard.authorize({
        channel: "telegram",
        chat: { id: "group-1", type: "supergroup" },
        user: { id: "42" },
      })
    ).toEqual({
      allowed: false,
      reason: "group_chat_requires_allowlist",
      message: "Unauthorized.",
    });
  });
});
