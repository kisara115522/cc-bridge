import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import TelegramBot from "node-telegram-bot-api";

import type {
  ChannelAdapter,
  ChannelAttachment,
  ChannelCapabilities,
  ChannelHandlers,
  ChannelInteraction,
  ChannelTarget,
  DownloadedAttachment,
  InteractionAnswer,
  OutboundMessage,
  SentMessageRef
} from "../channel/types.js";
import {
  channelButtonsToTelegramMarkup,
  telegramCallbackToInteraction,
  telegramMessageToInbound
} from "./telegramFormat.js";

export interface TelegramAdapterOptions {
  readonly token: string;
  readonly polling: boolean;
  readonly downloadDir: string;
  readonly bot?: TelegramBot;
}

export class TelegramChannelAdapter implements ChannelAdapter {
  readonly name = "telegram";
  readonly capabilities: ChannelCapabilities = {
    inlineButtons: true,
    messageEditing: true,
    fileDownload: true,
    typingIndicator: true,
    ephemeralInteractionAnswer: true,
    alertInteractionAnswer: true
  };
  private readonly bot: TelegramBot;

  constructor(private readonly options: TelegramAdapterOptions) {
    this.bot =
      options.bot ??
      new TelegramBot(options.token, {
        polling: options.polling
      });
  }

  async start(handlers: ChannelHandlers): Promise<void> {
    this.bot.on("message", (message) => {
      void handlers.onMessage(telegramMessageToInbound(message));
    });
    this.bot.on("callback_query", (query) => {
      const interaction = telegramCallbackToInteraction(query);
      if (interaction) {
        void handlers.onInteraction(interaction);
      }
    });
  }

  async stop(): Promise<void> {
    if (this.options.polling) {
      await this.bot.stopPolling();
    }
  }

  async sendMessage(target: ChannelTarget, message: OutboundMessage): Promise<SentMessageRef> {
    const sent = await this.bot.sendMessage(target.chatId, message.text, {
      reply_markup: channelButtonsToTelegramMarkup(message.buttons)
    });
    return {
      channel: "telegram",
      chatId: String(sent.chat.id),
      messageId: String(sent.message_id)
    };
  }

  async editMessage(ref: SentMessageRef, message: OutboundMessage): Promise<void> {
    await this.bot.editMessageText(message.text, {
      chat_id: ref.chatId,
      message_id: Number(ref.messageId),
      reply_markup: channelButtonsToTelegramMarkup(message.buttons)
    });
  }

  async answerInteraction(
    interaction: ChannelInteraction,
    response: InteractionAnswer
  ): Promise<void> {
    await this.bot.answerCallbackQuery(interaction.id, {
      text: response.text,
      show_alert: response.showAlert
    });
  }

  async downloadAttachment(attachment: ChannelAttachment): Promise<DownloadedAttachment> {
    await mkdir(this.options.downloadDir, { recursive: true });
    const link = await this.bot.getFileLink(attachment.id);
    const response = await fetch(link);
    if (!response.ok) {
      throw new Error(`Failed to download Telegram attachment ${attachment.id}: ${response.status}`);
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    const filename = attachment.filename ?? attachment.id;
    const path = join(this.options.downloadDir, filename);
    await writeFile(path, bytes);
    return {
      attachmentId: attachment.id,
      filename,
      mimeType: attachment.mimeType,
      data: bytes
    };
  }
}
