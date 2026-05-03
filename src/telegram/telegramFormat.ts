import type {
  ChannelAttachment,
  ChannelButtonRow,
  ChannelInteraction,
  InboundMessage,
  SentMessageRef
} from "../channel/types.js";

export interface TelegramUser {
  id: number;
  is_bot?: boolean;
  first_name?: string;
  last_name?: string;
  username?: string;
}

export interface TelegramChat {
  id: number;
  type: string;
}

export interface TelegramFileLike {
  file_id: string;
  file_unique_id?: string;
  file_name?: string;
  mime_type?: string;
  width?: number;
  height?: number;
}

export interface TelegramMessage {
  message_id: number;
  date: number;
  chat: TelegramChat;
  from?: TelegramUser;
  text?: string;
  caption?: string;
  document?: TelegramFileLike;
  photo?: TelegramFileLike[];
}

export interface TelegramCallbackQuery {
  id: string;
  from: TelegramUser;
  message?: TelegramMessage;
  data?: string;
}

export interface TelegramInlineKeyboardMarkup {
  inline_keyboard: Array<Array<{ text: string; callback_data: string }>>;
}

export function channelButtonsToTelegramMarkup(
  rows: readonly ChannelButtonRow[] | undefined
): TelegramInlineKeyboardMarkup | undefined {
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

export function telegramMessageToInbound(message: TelegramMessage): InboundMessage {
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

function telegramAttachments(message: TelegramMessage): ChannelAttachment[] {
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

export function telegramCallbackToInteraction(query: TelegramCallbackQuery): ChannelInteraction | null {
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
