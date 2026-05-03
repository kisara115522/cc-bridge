export type ChannelName = "telegram" | (string & {});

export interface ChannelCapabilities {
  readonly inlineButtons: boolean;
  readonly messageEditing: boolean;
  readonly fileDownload: boolean;
  readonly typingIndicator: boolean;
  readonly ephemeralInteractionAnswer: boolean;
  readonly alertInteractionAnswer: boolean;
}

export interface ChannelHandlers {
  readonly onMessage: (message: InboundMessage) => Promise<void>;
  readonly onInteraction: (interaction: ChannelInteraction) => Promise<void>;
}

export interface ChannelAdapter {
  readonly name: ChannelName;
  readonly capabilities: ChannelCapabilities;
  start(handlers: ChannelHandlers): Promise<void>;
  stop(): Promise<void>;
  sendMessage(target: ChannelTarget, message: OutboundMessage): Promise<SentMessageRef>;
  editMessage(ref: SentMessageRef, message: OutboundMessage): Promise<void>;
  answerInteraction(
    interaction: ChannelInteraction,
    response: InteractionAnswer
  ): Promise<void>;
  downloadAttachment(attachment: ChannelAttachment): Promise<DownloadedAttachment>;
}

export interface ChannelTarget {
  readonly channel: ChannelName;
  readonly chatId: string;
}

export interface ChannelUser {
  readonly id: string;
  readonly displayName?: string;
}

export interface ChannelChat {
  readonly id: string;
  readonly type: "private" | "group" | "supergroup" | "channel" | (string & {});
}

export interface InboundMessage {
  readonly channel: ChannelName;
  readonly id: string;
  readonly chat: ChannelChat;
  readonly user: ChannelUser | null;
  readonly text?: string;
  readonly attachments?: readonly ChannelAttachment[];
}

export interface OutboundMessage {
  readonly text: string;
  readonly buttons?: readonly ChannelButtonRow[];
}

export interface ChannelButtonRow {
  readonly buttons: readonly ChannelButton[];
}

export interface ChannelButton {
  readonly label: string;
  readonly value: string;
}

export interface SentMessageRef {
  readonly channel: ChannelName;
  readonly chatId: string;
  readonly messageId: string;
}

export interface ChannelInteraction {
  readonly channel: ChannelName;
  readonly id: string;
  readonly chat: ChannelChat;
  readonly user: ChannelUser | null;
  readonly messageRef?: SentMessageRef;
  readonly value: string;
}

export interface InteractionAnswer {
  readonly text?: string;
  readonly showAlert?: boolean;
}

export interface ChannelAttachment {
  readonly id: string;
  readonly filename?: string;
  readonly mimeType?: string;
}

export interface DownloadedAttachment {
  readonly attachmentId: string;
  readonly filename?: string;
  readonly mimeType?: string;
  readonly data: Uint8Array;
}
