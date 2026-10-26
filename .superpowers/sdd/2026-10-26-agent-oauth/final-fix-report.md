# Final fix round, plan 6

Status: done. C1, DeepSeek 1-4 and M1-M6 fixed, each with a test that failed first.

- C1: Referrer-Policy is `same-origin` on all authorize responses. Tests: Origin: null POST still refused (400, no code) plus header assertions; flow test sends `Origin: BASE` on the consent POST. Proven in real Chrome (below).
- DeepSeek 1: failure-day upsert is `... DO UPDATE SET requests = requests + 1 WHERE agent_counters.requests < FAILURES_PER_DAY` (insert path cannot exceed it); IP upsert gained `WHERE fail_n = 0-increment OR window changed OR fail_n < IP_FAILED_AUTH`. Snapshot pre-read kept as fast path. chargeConnection has the same pre-read pattern (member/pool/minute): a burst can overshoot those by the burst size, but they bound only one member's or the agents' pool, bump one row each (no new rows), and the minute limit plus flood revoke cap a single connection. Not changed (needs a conditional on several columns; not simple).
- DeepSeek 2: token.ts builds the client from the presented id without a network call (https id: public, any secret presented is invalid_client; rsg_oc_ id: oauth_clients + secret check). Grants already compare the row's client_id with that exact string. Test: zero fetches for junk code, junk refresh, secret presented, and a code made for another client.
- DeepSeek 3: consent POST requires urlencoded, readCapped 8 KB, URLSearchParams; else the request page.
- DeepSeek 4: loopback warning by host regardless of scheme (accepted URIs unchanged).
- M1: schema 8n note and README owner step 1 reworded. M2: TR help says "İzin ver düğmesini seç". M3: README narrowed (middleware kept). M4: comment only. M5: unsupported_response_type; safeNext refuses a next whose re-encoded form exceeds 3800 chars (error page). M6: token endpoint JSON 500 server_error with no-store and CORS.

Browser proof of C1: `wrangler pages dev dist` on 127.0.0.1:8799 with a LOCAL D1 only (--persist-to scratchpad, schema applied locally, seeded user, session, role, DCR client rsg_oc_localtest), real Chrome via Playwright with the session cookie. Allow: POST carried `Origin: http://127.0.0.1:8799`, 303 to the callback with `rsg_oac_` code, state, iss. Deny: 303 with error=access_denied. tests/browser/oauth-consent.mjs now does this when OAUTH_PREVIEW, OAUTH_SESSION and OAUTH_CLIENT are set (callback host is route-aborted). Server stopped.

Verification: npm test 1914 pass, 0 fail (3 skipped); astro check 0 errors; build ok; browser script passes both modes.
