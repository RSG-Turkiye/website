/** Stand-ins for Cloudflare's GraphQL Analytics endpoint, for the usage alert's tests. */
import type { Usage } from '../../functions/_lib/usage';

/** Answers like Cloudflare's GraphQL endpoint with this account's data, recording each parsed request body. */
export function fakeGql(seen: unknown[], accountData: unknown): typeof fetch {
  return (async (_url: RequestInfo | URL, init?: RequestInit) => {
    seen.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify({ data: { viewer: { accounts: [accountData] } }, errors: null }), { status: 200 });
  }) as typeof fetch;
}

/** The account data that reads back as these numbers (all requests on the Pages side). */
export function usageData(u: Usage) {
  return { workers: [], pages: [{ sum: { requests: u.requests } }], d1: [{ sum: { rowsRead: u.rowsRead, rowsWritten: u.rowsWritten } }] };
}

/** A fetcher whose answer reads back as these numbers. */
export function numbers(u: Usage): typeof fetch {
  return fakeGql([], usageData(u));
}

/** Answers like fakeGql, except that a query matching `failing` gets a GraphQL error: one dataset's name wrong, the others right. */
export function partialGql(seen: unknown[], accountData: unknown, failing: RegExp, message: string): typeof fetch {
  const ok = fakeGql(seen, accountData);
  return (async (url: RequestInfo | URL, init?: RequestInit) => {
    if (failing.test(String(JSON.parse(String(init?.body)).query))) return new Response(JSON.stringify({ data: null, errors: [{ message }] }), { status: 200 });
    return ok(url, init);
  }) as typeof fetch;
}

/** A GraphQL error answer: HTTP 200, no data, the message in errors. */
export function errorGql(message: string): typeof fetch {
  return (async () => new Response(JSON.stringify({ data: null, errors: [{ message }] }), { status: 200 })) as typeof fetch;
}

/**
 * The shape Cloudflare's GraphQL endpoint gives a query naming a field its
 * schema does not have: HTTP 200, data null, the reason in errors (with
 * locations, a path and extensions). The Pages Functions dataset and field
 * names come from an unofficial schema mirror, so this is the answer a wrong
 * name would get. It must read as a failure, never as a zero that hides usage.
 */
export const UNKNOWN_FIELD = {
  data: null,
  errors: [{
    message: 'Cannot query field "pagesFunctionsInvocationsAdaptiveGroups" on type "account".',
    path: ['viewer', 'accounts', 0, 'pages'],
    locations: [{ line: 4, column: 5 }],
    extensions: { code: 'GRAPHQL_VALIDATION_FAILED', timestamp: '2026-10-26T12:00:00.000Z' },
  }],
};
export const unknownFieldGql: typeof fetch = (async () => new Response(JSON.stringify(UNKNOWN_FIELD), { status: 200 })) as typeof fetch;
