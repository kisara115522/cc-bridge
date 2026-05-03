import { describe, expect, it } from "vitest";

import { TelegramChannelAdapter } from "../src/telegram/telegramAdapter.js";

function telegramJson(result: unknown): Response {
  return new Response(JSON.stringify({ ok: true, result }), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}

describe("TelegramChannelAdapter", () => {
  it("passes a proxy dispatcher to Telegram fetch calls when a proxy url is configured", async () => {
    let hasDispatcher = false;
    const adapter = new TelegramChannelAdapter({
      token: "token",
      polling: false,
      downloadDir: "/tmp/cc-bridge-test-downloads",
      apiBaseUrl: "https://telegram.test/bottoken",
      proxyUrl: "http://127.0.0.1:7897",
      fetchImpl: async (_input, init) => {
        hasDispatcher = Boolean(init && "dispatcher" in init);
        return telegramJson({
          message_id: 20,
          date: 1777777777,
          chat: { id: 42, type: "private" },
          text: "ok"
        });
      }
    } as ConstructorParameters<typeof TelegramChannelAdapter>[0]);

    await adapter.sendMessage({ channel: "telegram", chatId: "42" }, { text: "hello" });

    expect(hasDispatcher).toBe(true);
  });

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

  it("reports update handler failures separately from polling network failures", async () => {
    const updateErrors: string[] = [];
    const pollingErrors: string[] = [];
    let adapter: TelegramChannelAdapter;
    const updateFailed = new Promise<void>((resolve) => {
      adapter = new TelegramChannelAdapter({
        token: "token",
        polling: true,
        downloadDir: "/tmp/cc-bridge-test-downloads",
        apiBaseUrl: "https://telegram.test/bottoken",
        pollRetryDelayMs: 0,
        onPollingError: (error) => {
          pollingErrors.push(error instanceof Error ? error.message : String(error));
        },
        onUpdateError: (error) => {
          updateErrors.push(error instanceof Error ? error.message : String(error));
          resolve();
          void adapter.stop();
        },
        fetchImpl: async () =>
          telegramJson([
            {
              update_id: 10,
              message: {
                message_id: 20,
                date: 1777777777,
                chat: { id: 42, type: "private" },
                from: { id: 99, first_name: "Ada" },
                text: "/new codex"
              }
            }
          ])
      } as ConstructorParameters<typeof TelegramChannelAdapter>[0]);
    });

    await adapter!.start({
      onMessage: async () => {
        throw new Error("posix_spawnp failed.");
      },
      onInteraction: async () => {}
    });
    await updateFailed;
    await adapter!.stop();

    expect(updateErrors).toEqual(["posix_spawnp failed."]);
    expect(pollingErrors).toEqual([]);
  });
});
