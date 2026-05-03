import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

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
  telegramMessageToInbound,
  type TelegramCallbackQuery,
  type TelegramMessage
} from "./telegramFormat.js";
import { createProxyFetch } from "./proxyFetch.js";

export interface TelegramAdapterOptions {
  readonly token: string;
  readonly polling: boolean;
  readonly downloadDir: string;
  readonly apiBaseUrl?: string;
  readonly fetchImpl?: typeof fetch;
  readonly proxyUrl?: string;
  readonly pollRetryDelayMs?: number;
  readonly onPollingError?: (error: unknown) => void;
  readonly onUpdateError?: (error: unknown) => void;
}

interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
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
  private readonly apiBaseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly pollRetryDelayMs: number;
  private stopped = false;
  private pollPromise: Promise<void> | null = null;

  constructor(private readonly options: TelegramAdapterOptions) {
    this.apiBaseUrl = options.apiBaseUrl ?? `https://api.telegram.org/bot${options.token}`;
    this.fetchImpl = createProxyFetch(options.fetchImpl ?? fetch, options.proxyUrl);
    this.pollRetryDelayMs = options.pollRetryDelayMs ?? 1000;
  }

  async start(handlers: ChannelHandlers): Promise<void> {
    this.stopped = false;
    if (this.options.polling) {
      this.pollPromise = this.poll(handlers);
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    await this.pollPromise;
  }

  async sendMessage(target: ChannelTarget, message: OutboundMessage): Promise<SentMessageRef> {
    const sent = await this.callTelegram<TelegramMessage>("sendMessage", {
      chat_id: target.chatId,
      text: message.text,
      reply_markup: channelButtonsToTelegramMarkup(message.buttons)
    });
    return {
      channel: "telegram",
      chatId: String(sent.chat.id),
      messageId: String(sent.message_id)
    };
  }

  async editMessage(ref: SentMessageRef, message: OutboundMessage): Promise<void> {
    await this.callTelegram("editMessageText", {
      chat_id: ref.chatId,
      message_id: Number(ref.messageId),
      text: message.text,
      reply_markup: channelButtonsToTelegramMarkup(message.buttons)
    });
  }

  async answerInteraction(
    interaction: ChannelInteraction,
    response: InteractionAnswer
  ): Promise<void> {
    await this.callTelegram("answerCallbackQuery", {
      callback_query_id: interaction.id,
      text: response.text,
      show_alert: response.showAlert
    });
  }

  async downloadAttachment(attachment: ChannelAttachment): Promise<DownloadedAttachment> {
    await mkdir(this.options.downloadDir, { recursive: true });
    const file = await this.callTelegram<{ file_path: string }>("getFile", {
      file_id: attachment.id
    });
    const response = await this.fetchImpl(
      `https://api.telegram.org/file/bot${this.options.token}/${file.file_path}`
    );
    if (!response.ok) {
      throw new Error(`Failed to download Telegram attachment ${attachment.id}: ${response.status}`);
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    const filename = attachment.filename ?? attachment.id;
    await writeFile(join(this.options.downloadDir, filename), bytes);
    return {
      attachmentId: attachment.id,
      filename,
      mimeType: attachment.mimeType,
      data: bytes
    };
  }

  private async poll(handlers: ChannelHandlers): Promise<void> {
    let offset: number | undefined;
    while (!this.stopped) {
      let updates: TelegramUpdate[];
      try {
        updates = await this.callTelegram<TelegramUpdate[]>("getUpdates", {
          offset,
          timeout: 25,
          allowed_updates: ["message", "callback_query"]
        });
      } catch (error) {
        if (this.stopped) {
          return;
        }
        this.options.onPollingError?.(error);
        await sleep(this.pollRetryDelayMs);
        continue;
      }

      for (const update of updates) {
        offset = update.update_id + 1;
        try {
          if (update.message) {
            await handlers.onMessage(telegramMessageToInbound(update.message));
          }
          if (update.callback_query) {
            const interaction = telegramCallbackToInteraction(update.callback_query);
            if (interaction) {
              await handlers.onInteraction(interaction);
            }
          }
        } catch (error) {
          this.options.onUpdateError?.(error);
        }
      }
    }
  }

  private async callTelegram<T = unknown>(method: string, body: unknown): Promise<T> {
    const response = await this.fetchImpl(`${this.apiBaseUrl}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    });
    if (!response.ok) {
      throw new Error(`Telegram ${method} failed: ${response.status}`);
    }
    const payload = (await response.json()) as { ok: boolean; result?: T; description?: string };
    if (!payload.ok) {
      throw new Error(`Telegram ${method} failed: ${payload.description ?? "unknown error"}`);
    }
    return payload.result as T;
  }
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => setTimeout(resolve, ms));
}
