import { describe, expect, it } from "vitest";

import { createProxyFetch, resolveProxyUrl } from "../src/telegram/proxyFetch.js";

describe("proxy fetch", () => {
  it("resolves proxy environment variables in HTTPS-first order", () => {
    expect(
      resolveProxyUrl({
        HTTP_PROXY: "http://127.0.0.1:7890",
        HTTPS_PROXY: "http://127.0.0.1:7897"
      })
    ).toBe("http://127.0.0.1:7897");
  });

  it("adds an undici dispatcher when a proxy url is configured", async () => {
    let hasDispatcher = false;
    const fetchWithProxy = createProxyFetch(
      async (_input, init) => {
        hasDispatcher = Boolean(init && "dispatcher" in init);
        return new Response("ok");
      },
      "http://127.0.0.1:7897"
    );

    await fetchWithProxy("https://api.telegram.org");

    expect(hasDispatcher).toBe(true);
  });
});
