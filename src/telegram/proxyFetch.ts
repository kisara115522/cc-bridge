import { ProxyAgent, type Dispatcher } from "undici";

export function resolveProxyUrl(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return firstNonEmpty(
    env.HTTPS_PROXY,
    env.https_proxy,
    env.HTTP_PROXY,
    env.http_proxy,
    env.ALL_PROXY,
    env.all_proxy
  );
}

export function createProxyFetch(
  fetchImpl: typeof fetch = fetch,
  proxyUrl: string | undefined = resolveProxyUrl()
): typeof fetch {
  if (!proxyUrl) {
    return fetchImpl;
  }

  const dispatcher = new ProxyAgent(proxyUrl);
  return ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) =>
    fetchImpl(input, {
      ...init,
      dispatcher
    } as Parameters<typeof fetch>[1] & { dispatcher: Dispatcher })) as typeof fetch;
}

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  return values.map((value) => value?.trim()).find(Boolean);
}
