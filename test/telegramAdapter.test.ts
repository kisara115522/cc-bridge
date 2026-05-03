import { describe, expect, it } from "vitest";

import { TelegramChannelAdapter } from "../src/telegram/telegramAdapter.js";

function telegramJson(result: unknown): Response {
  return new Response(JSON.stringify({ ok: true, result }), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}

describe("TelegramChannelAdapter", () => {
  it("keeps polling after a transient getUpdates network failure", async () => {
    let adapter: TelegramChannelAdapter;
    let calls = 0;
    let resolveMessage: (() => void) | undefined;
    const messageSeen = new Promise<void>((resolve) => {
      resolveMessage = resolve;
    });

    adapter = new TelegramChannelAdapter({
      token: "token",
      polling: true,
      downloadDir: "/tmp/cc-bridge-test-downloads",
      apiBaseUrl: "https://telegram.test/bottoken",
      pollRetryDelayMs: 0,
      fetchImpl: async () => {
        calls += 1;
        if (calls === 1) {
          throw new TypeError("fetch failed");
        }
        return telegramJson([
          {
            update_id: 10,
            message: {
              message_id: 20,
              date: 1777777777,
              chat: { id: 42, type: "private" },
              from: { id: 99, first_name: "Ada" },
              text: "/status"
            }
          }
        ]);
      }
    });

    await adapter.start({
      onMessage: async () => {
        resolveMessage?.();
        void adapter.stop();
      },
      onInteraction: async () => {}
    });

    await messageSeen;
    expect(calls).toBeGreaterThanOrEqual(2);
  });
});
