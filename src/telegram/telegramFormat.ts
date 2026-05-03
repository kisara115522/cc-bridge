import type TelegramBot from "node-telegram-bot-api";

import type {
  ChannelAttachment,
  ChannelButtonRow,
  ChannelInteraction,
  InboundMessage,
  SentMessageRef
} from "../channel/types.js";

export function channelButtonsToTelegramMarkup(
  rows: readonly ChannelButtonRow[] | undefined
): TelegramBot.InlineKeyboardMarkup | undefined {
  if (!rows || rows.length === 0) {
    return undefined;
  }

  return {
    inline_keyboard: rows.map((row) =>
      row.buttons.map((button) => ({
        text: button.label,
        callback_data: button.value
      }))
    )
  };
}

export function telegramMessageToInbound(message: TelegramBot.Message): InboundMessage {
  return {
    channel: "telegram",
    id: String(message.message_id),
    chat: {
      id: String(message.chat.id),
      type: message.chat.type
    },
    user: message.from
      ? {
          id: String(message.from.id),
          displayName: [message.from.first_name, message.from.last_name].filter(Boolean).join(" ") || message.from.username
        }
      : null,
    text: message.text ?? message.caption,
    attachments: telegramAttachments(message)
  };
}

function telegramAttachments(message: TelegramBot.Message): ChannelAttachment[] {
  const attachments: ChannelAttachment[] = [];

  if (message.document) {
    attachments.push({
      id: message.document.file_id,
      filename: message.document.file_name,
      mimeType: message.document.mime_type
    });
  }

  const bestPhoto = message.photo?.at(-1);
  if (bestPhoto) {
    attachments.push({
      id: bestPhoto.file_id,
      filename: `photo-${bestPhoto.file_id}.jpg`,
      mimeType: "image/jpeg"
    });
  }

  return attachments;
}

export function telegramCallbackToInteraction(query: TelegramBot.CallbackQuery): ChannelInteraction | null {
  if (!query.message || !query.data) {
    return null;
  }

  const messageRef: SentMessageRef = {
    channel: "telegram",
    chatId: String(query.message.chat.id),
    messageId: String(query.message.message_id)
  };

  return {
    channel: "telegram",
    id: query.id,
    chat: {
      id: String(query.message.chat.id),
      type: query.message.chat.type
    },
    user: query.from
      ? {
          id: String(query.from.id),
          displayName: [query.from.first_name, query.from.last_name].filter(Boolean).join(" ") || query.from.username
        }
      : null,
    messageRef,
    value: query.data
  };
}
