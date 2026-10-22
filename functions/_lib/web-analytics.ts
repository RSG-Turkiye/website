// Page views from Cloudflare Web Analytics, read through Cloudflare's GraphQL
// API for the admin Statistics section. The beacon on the pages is what
// collects them; it sets no cookie and stores nothing personal. Counts only.
//
// Two settings: CF_ACCOUNT_ID (a var) and CF_ANALYTICS_TOKEN (a secret, an API
// token with "Account Analytics: Read" only). Without them the section says
// that visits are not set up, and everything else still shows.
//
// Cloudflare samples these events and keeps them for a limited time, so a
// period that starts before WEB_ANALYTICS_SINCE, or one Cloudflare refuses,
// comes back as null and is shown as a dash rather than as a wrong number.
import type { Period } from './stats';

const ENDPOINT = 'https://api.cloudflare.com/client/v4/graphql';

export const SITES = {
  main: 'rsg-turkiye.iscbsc.org',
  symposium: 'symposium.rsg-turkiye.iscbsc.org',
} as const;
export type Site = keyof typeof SITES;

export interface AnalyticsEnv {
  CF_ACCOUNT_ID?: string;
  CF_ANALYTICS_TOKEN?: string;
  /** YYYY-MM-DD the beacon went live; earlier periods have no data. */
  WEB_ANALYTICS_SINCE?: string;
  /** Local preview only (.dev.vars): a stand-in for Cloudflare's endpoint. */
  CF_GRAPHQL_URL?: string;
}

export interface Totals { views: number; visits: number }
export interface TopItem { name: string; views: number }
export interface SiteVisits {
  totals: (Totals | null)[];
  /** The last 30 days. */
  top: { pages: TopItem[]; referrers: TopItem[]; countries: TopItem[]; devices: TopItem[] } | null;
}

type Fetch = typeof fetch;

async function gql<T>(env: AnalyticsEnv, query: string, variables: Record<string, unknown>, fetcher: Fetch): Promise<T> {
  const res = await fetcher(env.CF_GRAPHQL_URL || ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.CF_ANALYTICS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = await res.json() as { data?: T; errors?: { message: string }[] | null };
  if (body.errors?.length) throw new Error(body.errors[0].message);
  if (!body.data) throw new Error('no data');
  return body.data;
}

const iso = (ts: number) => new Date(ts * 1000).toISOString();

function filter(host: string, from: number, to: number) {
  return { AND: [{ datetime_geq: iso(from), datetime_lt: iso(to) }, { requestHost: host }] };
}

const TOTAL = `query ($account: string, $filter: AccountRumPageloadEventsAdaptiveGroupsFilter_InputObject) {
  viewer { accounts(filter: { accountTag: $account }) {
    total: rumPageloadEventsAdaptiveGroups(filter: $filter, limit: 1) { count sum { visits } }
  } }
}`;

const TOP = `query ($account: string, $filter: AccountRumPageloadEventsAdaptiveGroupsFilter_InputObject) {
  viewer { accounts(filter: { accountTag: $account }) {
    pages: rumPageloadEventsAdaptiveGroups(filter: $filter, limit: 10, orderBy: [count_DESC]) { count dimensions { name: requestPath } }
    referrers: rumPageloadEventsAdaptiveGroups(filter: $filter, limit: 10, orderBy: [count_DESC]) { count dimensions { name: refererHost } }
    countries: rumPageloadEventsAdaptiveGroups(filter: $filter, limit: 10, orderBy: [count_DESC]) { count dimensions { name: countryName } }
    devices: rumPageloadEventsAdaptiveGroups(filter: $filter, limit: 5, orderBy: [count_DESC]) { count dimensions { name: deviceType } }
  } }
}`;

type Group = { count: number; sum?: { visits: number }; dimensions?: { name: string } };
type Accounts<K extends string> = { viewer: { accounts: Record<K, Group[]>[] } };

export function configured(env: AnalyticsEnv): boolean {
  return Boolean(env.CF_ACCOUNT_ID && env.CF_ANALYTICS_TOKEN);
}

function sinceTs(env: AnalyticsEnv): number | null {
  if (!env.WEB_ANALYTICS_SINCE || !/^\d{4}-\d{2}-\d{2}$/.test(env.WEB_ANALYTICS_SINCE)) return null;
  return Date.parse(`${env.WEB_ANALYTICS_SINCE}T00:00:00+03:00`) / 1000;
}

const items = (groups: Group[]): TopItem[] =>
  groups.filter((g) => g.dimensions?.name).map((g) => ({ name: g.dimensions!.name, views: g.count }));

export async function siteVisits(
  env: AnalyticsEnv, site: Site, periods: Period[], now: number, fetcher: Fetch = fetch,
): Promise<SiteVisits> {
  const host = SITES[site];
  const since = sinceTs(env);
  // Each period on its own, so one Cloudflare refuses (too far back, say)
  // costs only that column.
  const totals = await Promise.all(periods.map(async (p): Promise<Totals | null> => {
    if (since === null || p.to <= since) return null;
    try {
      const data = await gql<Accounts<'total'>>(env, TOTAL, { account: env.CF_ACCOUNT_ID, filter: filter(host, p.from, p.to) }, fetcher);
      const g = data.viewer.accounts[0]?.total[0];
      return { views: g?.count ?? 0, visits: g?.sum?.visits ?? 0 };
    } catch {
      return null;
    }
  }));
  let top: SiteVisits['top'] = null;
  try {
    const data = await gql<Accounts<'pages' | 'referrers' | 'countries' | 'devices'>>(
      env, TOP, { account: env.CF_ACCOUNT_ID, filter: filter(host, now - 30 * 86400, now) }, fetcher,
    );
    const a = data.viewer.accounts[0];
    if (a) top = { pages: items(a.pages), referrers: items(a.referrers), countries: items(a.countries), devices: items(a.devices) };
  } catch {
    top = null;
  }
  return { totals, top };
}
