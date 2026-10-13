/** Stubs the given hosts and passes every other URL to the fetch installed before. JSON bodies are parsed, form bodies become URLSearchParams, anything else (FormData, bytes) is kept as sent. */
export type HttpCall = { method: string; url: URL; headers: Headers; body: unknown };

export function stubHttp(hosts: string[], handler: (c: HttpCall) => Response | undefined) {
  const calls: HttpCall[] = [];
  const before = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = input instanceof Request ? input : null;
    const url = new URL(String(req ? req.url : input));
    if (!hosts.includes(url.host)) return before(input, init);
    let body: unknown = init?.body ?? null;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch { body = new URLSearchParams(body); }
    }
    const c: HttpCall = { method: (init?.method ?? req?.method ?? 'GET').toUpperCase(), url, headers: new Headers(init?.headers ?? req?.headers), body };
    calls.push(c);
    const res = handler(c);
    if (!res) throw new Error(`unexpected call ${c.method} ${url.href}`);
    return res;
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = before; } };
}
