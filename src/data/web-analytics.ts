// Cloudflare Web Analytics beacon token for this site. It is public by design:
// it is printed in every page's HTML. Empty means no beacon; it is set once
// the site is added under Cloudflare > Web Analytics (README, Statistics).
// The admin Statistics section reads the counts back through the GraphQL API.
export const WEB_ANALYTICS_TOKEN = '';

/** Pages where a signed-in person works; they are not counted. */
export const UNCOUNTED = /^\/(tr\/)?(admin|account)(\/|$)/;
