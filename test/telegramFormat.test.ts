import { describe, expect, it } from "vitest";

import { channelButtonsToTelegramMarkup, telegramMessageToInbound } from "../src/telegram/telegramFormat.js";

describe("telegram formatting", () => {
  it("converts channel buttons to Telegram inline keyboard markup", () => {
    expect(
      channelButtonsToTelegramMarkup([
        {
          buttons: [
            { label: "Up", value: "up-data" },
            { label: "Enter", value: "enter-data" }
          ]
        }
      ])
    ).toEqual({
      inline_keyboard: [
        [
          { text: "Up", callback_data: "up-data" },
          { text: "Enter", callback_data: "enter-data" }
        ]
      ]
    });
  });

  it("converts Telegram private text messages to inbound messages", () => {
    expect(
      telegramMessageToInbound({
        message_id: 10,
        date: 1777777777,
        chat: { id: 42, type: "private" },
        from: { id: 99, is_bot: false, first_name: "Ada" },
        text: "/status"
      })
    ).toEqual({
      channel: "telegram",
      id: "10",
      chat: { id: "42", type: "private" },
      user: { id: "99", displayName: "Ada" },
      text: "/status",
      attachments: []
    });
  });

  it("converts Telegram documents and photos to attachments", () => {
    expect(
      telegramMessageToInbound({
        message_id: 11,
        date: 1777777777,
        chat: { id: 42, type: "private" },
        from: { id: 99, is_bot: false, first_name: "Ada" },
        caption: "inspect",
        document: {
          file_id: "doc-file",
          file_unique_id: "doc-unique",
          file_name: "notes.txt",
          mime_type: "text/plain"
        },
        photo: [
          {
            file_id: "small-photo",
            file_unique_id: "small-unique",
            width: 10,
            height: 10
          },
          {
            file_id: "large-photo",
            file_unique_id: "large-unique",
            width: 100,
            height: 100
          }
        ]
      })
    ).toMatchObject({
      text: "inspect",
      attachments: [
        { id: "doc-file", filename: "notes.txt", mimeType: "text/plain" },
        { id: "large-photo", filename: "photo-large-photo.jpg", mimeType: "image/jpeg" }
      ]
    });
  });
});
