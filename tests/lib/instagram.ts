/** Stubs Instagram's hosts and passes every other URL to the fetch installed before (stubMail, for example). */
export type GraphCall = { method: string; host: string; path: string; params: URLSearchParams };

const HOSTS = ['graph.instagram.com', 'api.instagram.com'];

export function stubGraph(handler: (c: GraphCall) => Response | undefined) {
  const calls: GraphCall[] = [];
  const before = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    if (!HOSTS.includes(url.host)) return before(input, init);
    const params = new URLSearchParams(url.search);
    if (init?.body) for (const [k, v] of new URLSearchParams(String(init.body))) params.set(k, v);
    const c = { method: (init?.method ?? 'GET').toUpperCase(), host: url.host, path: url.pathname.replace(/^\/v\d+\.\d+/, ''), params };
    calls.push(c);
    const res = handler(c);
    if (!res) throw new Error(`unexpected Instagram call ${c.method} ${c.host}${c.path}`);
    return res;
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = before; } };
}
