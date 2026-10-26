# Agent OAuth (Web Connectors for the MCP Endpoint) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A member adds `https://rsg-turkiye.iscbsc.org/api/mcp` as a custom connector in claude.ai (web, desktop, mobile) or ChatGPT (developer mode), signs in with Google on our site, picks which areas and levels the connector gets, and never copies a token; the connection is an agent credential exactly like a personal token (same route table, scopes, rights, limits, audit marker), listed in the panel with one-click disconnect.

**Architecture:**
- **The site is its own authorization server**, hand-rolled on D1 (Call 1), issuer `https://rsg-turkiye.iscbsc.org`. Discovery is RFC 9728 protected resource metadata plus RFC 8414 authorization server metadata, served by Pages Functions under `/.well-known/`. Endpoints live under `/oauth/` (outside `/api/`, so the bearer middleware never sees them): `authorize` (consent page, Google sign-in through the existing `/auth/login`), `token`, `register`.
- **Clients identify themselves two ways, both standard:** a Client ID Metadata Document (CIMD: the `client_id` is an https URL we fetch; nothing is stored; this is what Claude and ChatGPT pick) or Dynamic Client Registration (RFC 7591: one capped, rate-limited row; Cursor, VS Code, Perplexity, Raycast, Copilot Studio, Gemini CLI). No client is special-cased.
- **A connection is one row in `agent_tokens`** with `kind = 'oauth'` (Call 2). Its access token (`rsg_oat_…`, 1 hour) is looked up through the same `token_hash` UNIQUE index as a personal token and is rotated in place on refresh, so the row id (the audit marker, the counter key, `agent_token_id` on drafts) is stable for the life of the connection and dead access tokens leave no rows. The refresh token (`rsg_ort_<row id>.<secret>`) is found by primary key, stored as a hash, rotated on every use; reuse of the previous one revokes the connection.
- **Everything downstream is unchanged.** `authenticateAgent` accepts the new prefix, checks the access expiry and that the route is `/api/mcp` (the token's audience, Call 4), then runs the plan-5 path: scope ∩ live grants, approve never, the route table, `checkToken`, the counters, the audit marker. Revoking (member or admin) is the existing `DELETE /api/agent-tokens/:id`.
- **Panel.** The "Ajan anahtarları / Agent tokens" section gets a second list, "Bağlı uygulamalar / Connected apps", with "Bağlantıyı kes / Disconnect", and a plain help box "Claude'a bağla / ChatGPT'ye bağla".

**Tech Stack:** Cloudflare Pages Functions, D1, Web Crypto (SHA-256, `getRandomValues`), the existing panel client (`src/scripts/admin/*`, `src/i18n/ui.ts`), node:test with `tests/lib/d1-sqlite.ts` and `tests/lib/http.ts` (`stubHttp`), Playwright. No new dependency.

**Spec:** there is no separate spec file. The owner's binding decisions (2026-10-26) are copied verbatim into Global Constraints below and travel with this plan; plan 5 (`docs/superpowers/plans/2026-10-25-agent-access.md`, its ledger `.superpowers/sdd/2026-10-25-agent-access/progress.md`) is the base, and all its rulings stand. Branch: on top of `feat/agent-access` after plan 5's final fixes (or `main` once it is merged).

## Sources relied on

- MCP authorization, current revision 2026-07-28: https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization (CIMD SHOULD, DCR MAY and deprecated, PRM MUST, `iss` SHOULD with `authorization_response_iss_parameter_supported`, refresh rotation for public clients, 401/403 rules, audience validation). Revision 2025-11-25, which Claude's docs link: https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization (well-known probing order, CIMD rules: exact `client_id` match, exact redirect match, show the redirect host, SSRF care, loopback warning).
- Claude connectors: https://claude.com/docs/connectors/building/authentication (CIMD only when AS metadata has `client_id_metadata_document_supported: true` **and** `"none"` in `token_endpoint_auth_methods_supported`, else DCR; callback `https://claude.ai/api/mcp/auth_callback`, may become `https://claude.com/api/mcp/auth_callback`; Claude Code loopback port-agnostic `localhost` and `127.0.0.1`; 401 with `resource_metadata` required; first `authorization_servers` entry only; PRM `resource` equals the URL the user typed; `/token` must take form-urlencoded; `invalid_grant` on a dead refresh token; rotate refresh tokens; 10 s / 30 s timeouts; egress `160.79.104.0/21`). https://claude.com/docs/connectors/building/lazy-authentication.md (401 shape, CIMD example, port-agnostic loopback, discovery cached about 5 minutes). https://claude.com/docs/connectors/custom/add-unlisted.md (plans and steps).
- ChatGPT: https://developers.openai.com/apps-sdk/build/auth (CIMD `https://chatgpt.com/oauth/client.json` and redirect `https://chatgpt.com/connector_platform_oauth_redirect` when the AS meets RFC 9207, otherwise per-callback-id URLs; `issuer` must equal the PRM `authorization_servers` entry exactly; `code_challenge_methods_supported` must include `S256`; `resource` on both requests).
- Cloudflare: https://github.com/cloudflare/workers-oauth-provider (wraps a Worker's default export, needs a KV namespace `OAUTH_KV`), https://developers.cloudflare.com/kv/platform/limits/ (Free: 1,000 KV writes a day). Pages Functions routing walks every directory with `readdir`, dot directories included (checked in wrangler 4.152.0's `forEachFile`), so `functions/.well-known/…` routes; Task 2 still verifies it on a local Pages server.
- Other clients: see "Client compatibility" below; each row names its source and whether it is official documentation, a vendor guide or a community report.

## Client compatibility (research, 2026-10-26)

The server stays standards-based (RFC 9728 + RFC 8414 + CIMD + DCR + PKCE S256 + RFC 9207 `iss`). This table only predicts who that serves.

| Client | Remote MCP with OAuth | How it registers | Redirect URI | Plan or tier | Works after plan 6 | Source |
|---|---|---|---|---|---|---|
| claude.ai web, Desktop, mobile | yes | CIMD (Anthropic-hosted document) when advertised as above, else DCR; or a client id the user types | `https://claude.ai/api/mcp/auth_callback` (may move to claude.com) | Free (one custom connector), Pro, Max; Team and Enterprise: an Owner adds it, members connect | yes, by CIMD | official: claude.com authentication, add-unlisted |
| Claude Code | yes | CIMD `https://claude.ai/oauth/claude-code-client-metadata` | `http://localhost:<any>/callback`, `http://127.0.0.1:<any>/callback` | any | yes (loopback, Call 9); the PAT stays the documented way for terminals | official: claude.com authentication |
| ChatGPT developer mode | yes | CIMD `https://chatgpt.com/oauth/client.json` (with RFC 9207), else DCR | `https://chatgpt.com/connector_platform_oauth_redirect` (with RFC 9207) | developer guide: Plus, Pro, Business, Enterprise, Edu on the web; help center: write actions in beta for Business, Enterprise, Edu. The two conflict | yes, by CIMD; write tools may depend on the member's plan | official: developers.openai.com/apps-sdk/build/auth; plan conflict from developers.openai.com/api/docs/guides/developer-mode and help.openai.com/articles/12584461 (search snippets, pages not fetchable) |
| Microsoft Copilot Studio | yes | "Dynamic discovery" (DCR), or a manual client | generated per connector, shown in Copilot Studio | tenant, maker licence | yes, by DCR | vendor guides: support.hudu.com/hc/en-us/articles/40745081033879, docs.timbr.ai/doc/docs/integration/mcp/authentication/oauth |
| Microsoft 365 Copilot (declarative agents) | yes | a client registered in the Teams developer portal; Agents Toolkit 6.12+ can use DCR | `https://teams.microsoft.com/api/platform/v1.0/oAuthRedirect` | tenant admin, developer tooling | by DCR through the toolkit; a pre-registered client is an owner question | official: learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/plugin-authentication-oauth; microsoft.github.io/copilot-camp/pages/extend-m365-copilot/10-mcp-auth/ |
| Gemini app (consumer) | no custom MCP connector found | | | | no | search found none |
| Gemini Enterprise | yes (Custom MCP Server data store) | pre-registered client only; no DCR, no discovery | `https://vertexaisearch.cloud.google.com/oauth-redirect` | admin only, Google Cloud org policy | needs a pre-registered client: owner question | official: docs.cloud.google.com/gemini/enterprise/docs/connectors/custom-mcp-server/set-up-custom-mcp-server; DCR absence from vendor guides |
| Gemini CLI | yes | discovery and DCR | `http://localhost:7777/oauth/callback` | any | yes (loopback) | vendor guides: docs.pipeshub.com/mcp/gemini-cli, docs.zuora.com (redirect URIs by MCP client) |
| Mistral Le Chat | yes ("Custom MCP Connector", OAuth 2.1) | not documented | not documented | | probably by DCR; test after deploy | vendor guide: developers.make.com/mcp-server/connect-using-oauth/usage-with-mistral-ai |
| Perplexity | yes | DCR, or a client id and secret typed in; fails on a DCR answer without `client_secret` | not documented | Pro, Max, Enterprise (vendor guides disagree) | yes: every DCR answer carries a secret (Call 8) | vendor: conductor.com/docs/mcp/perplexity, agents.ramp.com/docs/connectors/perplexity; community: community.perplexity.ai/t/…/5172 |
| Cursor | yes | DCR, again on every reconnect; or a static client in `mcp.json` | `cursor://anysphere.cursor-mcp/oauth/callback`, newer builds also loopback (several URIs in one registration) | | yes: custom schemes and loopback allowed (Call 9); re-registration is what the DCR caps absorb | community reports: forum.cursor.com (several threads, 2025-10 to 2026-06) |
| VS Code / GitHub Copilot agent mode | yes | DCR; or a static `clientId` | `http://127.0.0.1:33418` (port can change), `https://vscode.dev/redirect`, `https://insiders.vscode.dev/redirect` | | yes: loopback matched port-agnostic | github.com/microsoft/vscode/issues/278512; zuplo.com/learn/mcp/errors/dynamic-client-registration-not-supported |
| Windsurf | `serverUrl`; OAuth in recent builds per some vendors, not per others | presumably DCR | not documented | | maybe; the PAT header is the fallback | vendor guides disagree: docs.bitrise.io (yes), docs.atlan.com (no) |
| Zed | yes: a `url` without an `Authorization` header starts OAuth | standard MCP client flow | loopback | | yes | official: zed.dev/docs/ai/mcp.md |
| LM Studio | remote servers with header auth (official); OAuth only per a vendor guide | | | | PAT header | official: lmstudio.ai/docs/app/mcp |
| Raycast | yes: "Dynamic OAuth" (DCR + PKCE) or "Static OAuth" (client id) | DCR | not documented | | yes, by DCR | official: manual.raycast.com/ai/model-context-protocol |

## Calls made in this plan (the spec, the clients or the code left them open)

1. **Controller call: hand-rolled provider on D1, not `workers-oauth-provider`.** That library wraps a Worker's default export (this site is Pages Functions) and needs a KV namespace; KV's free tier allows 1,000 writes a day, which grants, codes and hourly refreshes would exhaust. D1 is already the store, its budget is already counted, and five small files are easier for a volunteer to read than a framework.
2. **Controller call: a connection is an `agent_tokens` row (`kind = 'oauth'`), rotated in place.** One indexed lookup per request (plan 5's budget), and the token id that the audit log, counters, `agent_token_id` and the revoke endpoint use stays stable. New access tokens on new rows would leave 24 dead rows a day per connection.
3. **Controller call: lifetimes.** Access token 3,600 s; authorization code 120 s; the connection itself lives 7, 30 or 90 days (default 30), chosen on the consent screen like a token's life, and no refresh extends it; at most 5 live connections per member (apart from the 5 personal tokens); at most 5 unexpired codes per member.
4. **Controller call: an OAuth access token is accepted on `/api/mcp` only.** Its audience (RFC 8707, the PRM `resource`) is `https://rsg-turkiye.iscbsc.org/api/mcp`. The route table and the middleware still apply unchanged; on any other table route an OAuth token gets the generic 401. Web connectors only speak MCP, and image upload stays a PAT/REST feature.
5. **Controller call: scopes are plan 5's `area:level` strings.** PRM and AS metadata list all twelve in `scopes_supported`; no `scope` in the 401 challenge. The requested scope only pre-fills the consent form (intersected with what the member holds; unknown values ignored; nothing requested means nothing pre-ticked). The token response returns the granted `scope`. `offline_access` is not advertised and is ignored if sent; every connection gets a refresh token. No `insufficient_scope` step-up: a tool the connection lacks is not listed, as today.
6. **Controller call: refresh rotation with reuse detection, keyed by row id.** The refresh value embeds the row id, so lookup is by primary key and no refresh index is written. The previous hash is kept: presenting it within 60 s of the rotation (a client retrying a lost answer) is `invalid_grant` only; later it revokes the connection (`refresh_reuse`, one `agent_token.auto_revoke` row).
7. **Controller call: token-endpoint requests count as requests of that connection.** A code exchange and a refresh each pass the IP cut-off, the minute limit, the member's 300 a day and the agents' pools, and bump the connection's counter row; the reserve may serve a connection whose scopes include `social`. Refused: 429 `{ "error": "rate_limited" }` with `Retry-After`, no write. Failures (bad code, bad verifier, bad refresh, bad secret) are failed authentications (`countFailedAuth`). An hourly refresh costs 24 of a member's 300.
8. **Controller call: DCR answers always carry a `client_secret`** (stored as a hash), whatever `token_endpoint_auth_method` was asked (default `client_secret_basic`, RFC 7591 §2). A `none` client may omit it at `/oauth/token` (PKCE protects it); a presented secret is always checked. Perplexity rejects a public-client answer without a secret.
9. **Controller call: redirect URIs.** Allowed: `https://` (no fragment), `http://localhost`, `http://127.0.0.1`, `http://[::1]` (loopback compared with the port ignored, RFC 8252 §7.3, as Claude Code and VS Code need), and private-use schemes (`^[a-z][a-z0-9+.-]*:`, not `http`, `javascript`, `data`, `file`, `vbscript`, `about`, `blob`, `ws`, `wss`, `ftp`; Cursor needs one). Everything else is refused. The consent screen always shows where the code goes (host, or the whole URI for loopback and custom schemes) and warns for loopback and custom schemes (MCP spec MUST). Owner question 2 can narrow this to https only.
10. **Controller call: CIMD fetch policy is open, with guards** (MCP spec "trust policies" MAY; refusing a host would strand that client, which does not fall back to DCR). `client_id` must be `https://`, have a path, be at most 512 characters, not be an IP literal and not be our own host. Fetch with `redirect: 'manual'` (any 3xx refused), a 5 s timeout, a 16 KB streamed cap, JSON only; the document's `client_id` must equal the URL exactly and `redirect_uris` must be a non-empty array. No cache: fetched on the consent GET and again on its POST (two fetches per connect, no D1).
11. **Controller call: RFC 9207.** Every authorization response, error or not, carries `iss=https://rsg-turkiye.iscbsc.org`, and the AS metadata says `authorization_response_iss_parameter_supported: true`. It is what gives ChatGPT its stable client id and redirect URI.
12. **Controller call: the consent screen is HTML rendered by the Function** (`functions/_lib/oauth-consent.ts`), not an Astro page: it needs the request's parameters, the session and the member's live areas in one response, and works with no script. Language from `Accept-Language` (`tr…` gives Turkish, otherwise English), switchable by a link that adds `rsg_lang=tr|en`, kept through the form. Its strings live in that file (both languages side by side), not `ui.ts`, so the Function bundle stays small; the panel strings go in `ui.ts` as usual. Headers: `Cache-Control: no-store`, `X-Frame-Options: DENY`, `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'`, `Referrer-Policy: no-referrer`. No `form-action` directive (Chrome applies it to the redirect after the POST).
13. **Controller call: the POST answer is `303 See Other`** to the redirect URI, never 307 (a 307 re-POSTs to the client's callback; Claude's callback answers 405 to that).
14. **Controller call: sign-in reuses `/auth/login?next=`.** `safeNext` (`functions/_lib/next-path.ts`) also accepts `/oauth/authorize` with its query, up to 2,048 characters. Nothing is stored server-side before sign-in.
15. **Controller call: no RFC 7009 revocation endpoint and no OpenID discovery document.** Disconnecting is done in the panel; MCP clients must support RFC 8414 discovery. Both can be added later without changing anything here.
16. **Controller call: audit.** The code exchange writes `agent_token.create` with `{ kind: 'oauth', client: <host>, scopes, expires_at }` as the member; disconnect is the existing `agent_token.revoke`; reuse is `agent_token.auto_revoke` with `{ reason: 'refresh_reuse' }`. DCR registration is anonymous and not audited (no person acted; it is capped).
17. **Controller call: CORS `*` on the discovery documents, `/oauth/token` and `/oauth/register`** (no cookies there), with `OPTIONS` answered 204 (`Access-Control-Allow-Methods: GET, POST, OPTIONS`, `Access-Control-Allow-Headers: Content-Type, Authorization, MCP-Protocol-Version`): standard hygiene for clients that discover from a browser. Not on `/oauth/authorize`. Plan 5's `Origin` check on `/api/mcp` is left as it is, so a browser-hosted client still cannot call the MCP endpoint itself.
18. **Controller call: the MCP endpoint also speaks protocol version `2025-11-25`.** For a tools-only, JSON-answer, stateless server it is the same wire format as `2025-06-18`; clients that ask for it then keep it. `2026-07-28` (stateless core) is a later plan.

## Open questions for the owner (each changes what is built; the plan's default in brackets)

1. **Pre-registered clients.** Gemini Enterprise (no DCR, admin-only) and Microsoft 365 Copilot declarative agents (Teams developer portal) need a client id and secret that an admin creates on our side, which means an admin "OAuth clients" form in the panel. [Not built in plan 6; they are listed as unsupported.]
2. **Native and desktop redirects.** Loopback (`http://127.0.0.1:*`, `http://localhost:*`) and custom schemes (`cursor://…`) let Claude Code, Gemini CLI, Cursor, VS Code, Zed and Raycast connect without a token, at the cost that any local program can claim a known app's name (the consent screen warns and shows the target). [Allowed, Call 9.] The alternative is https redirects only: Claude and ChatGPT web still work; terminals and editors keep using personal tokens.
3. **OAuth tokens beyond `/api/mcp`.** [MCP only, Call 4.] The alternative lets a connection call every REST route in the table too, which no current web connector needs.

## Global Constraints

The owner's binding decisions, verbatim:

- Support BOTH personal bearer tokens (unchanged) and OAuth for web connectors.
- OAuth-issued access is just another kind of agent credential: same route table, same scopes, same budgets and limits (counted against the same member and global pools), same audit marker, revocable by the member and by admins.
- Consent screen in TR/EN shows exactly which areas and levels the connector gets (the member picks, never more than they hold; never approve).
- The panel's Ajan anahtarları section also lists connected apps with one-click disconnect.
- A plain step-by-step help box "Claude'a bağla / ChatGPT'ye bağla".
- Access tokens short-lived, refresh tokens rotated and revocable, stored as hashes only.
- Nothing on the per-minute cron tick.
- D1 writes per OAuth request within the plan-5 budget (count them).
- Registration endpoints rate limited and capped so they cannot fill D1.
- The UI plain like the existing panel (design pass later); public repo hygiene; bilingual.
- Keep the server standards-based (RFC 9728 + 8414 + DCR/CIMD + PKCE) rather than special-casing clients.

From plan 5 and CLAUDE.md, unchanged:

- Rights = scope ∩ live grants, recomputed per request; approve never; social `isPublisher: false`; own drafts only; 404 for colleagues' ids; every action audited with the token id; `getSessionUser` unchanged; `/api/agent-tokens*` session only.
- Budgets (`LIMITS` in `functions/_lib/agent-limits.ts`): agents 15,000 requests a day (12,000 general, 3,000 social reserve), 2,000 handler writes a day (1,600 + 400), 5,000 counted failures a day, 300 requests per member a day, 30 a minute per credential.
- Secrets: token, refresh, code and client-secret values are generated on the server, returned once, never stored (SHA-256 hex only), never logged or audited, never in an error. `console.error` prints error names only.
- Public repo: `example.org` addresses in tests; the only URLs given to members are on `rsg-turkiye.iscbsc.org`; never a `*.pages.dev`, `*.r2.dev` or `*.workers.dev` URL.
- Migration note **8n** at the top of `db/schema.sql` after 8l, with the exact `wrangler d1 execute rsg-members --remote …` commands; the owner runs it before the merge. Nothing in this plan touches the remote D1.
- UI rules as plans 3 to 5: strings in both languages, no em dash in any string, checked at 1280×680, 1366×768, 1440×800, 1536×864, 1440×900, 1920×1080 and 390 px, no inner scrollbars, `admin-overflow.mjs` and `admin-fit-viewport.mjs` re-run, shown to the owner as a local preview link before any push.

**Fixed values** (all in `functions/_lib/oauth-config.ts`, Task 1):

| Name | Value |
|---|---|
| `ISSUER` | `https://rsg-turkiye.iscbsc.org` |
| `MCP_RESOURCE` | `https://rsg-turkiye.iscbsc.org/api/mcp` |
| `PRM_URL` | `https://rsg-turkiye.iscbsc.org/.well-known/oauth-protected-resource/api/mcp` |
| `ACCESS_TTL` / `CODE_TTL` / `REUSE_GRACE` | 3600 / 120 / 60 seconds |
| `CONNECTION_DAYS` / `DEFAULT_DAYS` | `[7, 30, 90]` / 30 |
| `MAX_CONNECTIONS` / `MAX_LIVE_CODES` | 5 / 5 per member |
| Prefixes | access `rsg_oat_`, refresh `rsg_ort_`, code `rsg_oac_`, DCR client id `rsg_oc_`, DCR secret `rsg_ocs_`; each followed by 43 base64url characters (32 random bytes); refresh is `rsg_ort_<row uuid>.<43>` |
| Registration caps | 10 per IP (its /64 for IPv6) per UTC day; 200 for everyone per UTC day; body 8 KB; at most 5 `redirect_uris`, each at most 512 characters; `client_name` at most 100 |
| CIMD fetch | 5 s timeout, 16 KB, no redirects |
| `/oauth/token` body | 8 KB, `application/x-www-form-urlencoded` |

**D1 rows written per OAuth request** (index entries counted; plan 5's request cost unchanged):

| Request | Rows written | Bounded by |
|---|---|---|
| `/api/mcp` without a token (the 401 that starts sign-in) | 0 | Workers requests only |
| Discovery documents, `OPTIONS` | 0 (no D1 at all) | |
| `GET /oauth/authorize` (signed in or not) | 0 | |
| `POST /oauth/authorize` (Allow) | 1 code row, plus the member's expired codes deleted in the same batch | 5 live codes per member |
| `POST /oauth/authorize` (Deny) | 0 | |
| `/oauth/register` | 3 (client row, the IP's counter row, the day's registration row); refused: 0 | 10 per IP, 200 a day |
| `/oauth/token`, code exchange | about 8: code delete 1, `agent_tokens` insert 1 + `token_hash` unique index 1 + `idx_agent_tokens_user` 1, audit row with its two indexes 3, counter 1 | one per Allow |
| `/oauth/token`, refresh | about 4: the row 1 + `token_hash` index change 2, counter 1 | the connection's minute limit, the member's 300 a day, the agents' 15,000 |
| `/oauth/token`, any failure | 2 (failed authentication), 0 past 5,000 a day or from a cut-off IP | plan 5's failure caps |
| `/api/mcp` with an OAuth token | as a personal token: 1 counter row (+ `last_used_at` at most every 5 minutes) | plan 5 |

Worst case for refreshes: 30 panel members × 5 connections × 24 refreshes × 4 rows = 14,400 rows a day, inside the agents' 15,000 requests; realistic use (a few connections) is a few hundred.

## Review Focus

1. **A client's callback refusing our redirect, or a redirect to somewhere unregistered.** Allow answers 303 (not 307) with `code`, `state` and `iss`; Deny and every post-validation error answer 303 with `error`, `state`, `iss`; an unknown client, an unregistered `redirect_uri` or a CIMD document that cannot be fetched shows an error page and never redirects. Task 4.
2. **A refresh token used twice.** The second use within 60 s is `invalid_grant` and the connection lives; after 60 s it revokes the connection with exactly one `agent_token.auto_revoke` row; after either, the old access token is 401 at `/api/mcp`; two refreshes racing with the same value rotate once. Task 5.
3. **A code redeemed twice, by another client, with a wrong verifier or a different `redirect_uri`.** All `invalid_grant`, nothing issued, and the first good redemption still works only once. Task 5.
4. **A connection whose member's world changes.** The role ends: the next `tools/list` loses those tools with no write to the connection. The member disconnects in the panel: the next MCP request is 401 and the next refresh `invalid_grant`. The access token on `/api/cms/drafts`: 401. The consent POST asking for an area the member does not hold (a forged form): 400 page, no code. Tasks 1, 4, 5, 8.
5. **Anonymous traffic on the new endpoints.** 11 registrations from one IP or 201 in a day: the extra ones are 429 and write nothing. A CIMD URL that redirects, is slow, is over 16 KB, is not JSON, is our own host or whose `client_id` differs: refused, nothing stored. Anonymous `GET /oauth/authorize`: no D1 write. Tasks 3, 4, 6.

## Execution order and independence

- **Task 1** first.
- **Then Tasks 2, 3 and 7 are independent of each other** (disjoint files).
- **Tasks 4, 5 and 6 need Tasks 2 and 3 (5 and 6 use `cors`/`preflight`) and are independent of each other** (disjoint files; `tests/agent-tokens.test.ts`'s import allowlist already names their files from Task 1).
- **Task 8** last (needs all).

---

### Task 1: The connection as an agent credential (schema, config, resource side)

**Files:**
- Create: `functions/_lib/oauth-config.ts`
- Modify: `db/schema.sql` (note 8n after 8l; columns in `CREATE TABLE agent_tokens`; new tables `oauth_clients`, `oauth_codes`)
- Modify: `functions/_lib/agent-tokens.ts` (`VALUE`, `TokenRow`, `authenticateAgent`, `unauthorized`)
- Modify: `functions/api/_middleware.ts` (`TOKEN`, `lookup`)
- Modify: `functions/api/agent-tokens/index.ts` (`COLUMNS`, `TokenRow`, `tokenJson`, the live-count in `onRequestPost`)
- Modify: `functions/api/admin/audit/prune.ts`
- Test: `tests/oauth-core.test.ts` (create); update `tests/agent-tokens.test.ts` (import allowlist, `WWW-Authenticate` value), `tests/agent-abuse.test.ts:562`, `tests/agent-social.test.ts:212`, `tests/agent-token-api.test.ts`, `tests/audit-prune.test.ts`; `tests/lib/agent.ts` (`mintConnection`)

**Interfaces:**
- Produces, `functions/_lib/oauth-config.ts` (imports nothing from `agent-tokens.ts`): the fixed values table above as exported constants (`ISSUER`, `MCP_RESOURCE`, `PRM_URL`, `ACCESS_TTL`, `CODE_TTL`, `REUSE_GRACE`, `CONNECTION_DAYS`, `DEFAULT_DAYS`, `MAX_CONNECTIONS`, `MAX_LIVE_CODES`, `PREFIX = { access, refresh, code, client, secret }`); `newValue(prefix: string): string`; `sha256Hex(value: string): Promise<string>`; `isCanonicalResource(v: string): boolean` (equals `MCP_RESOURCE` after lower-casing scheme and host; no trailing slash, no query, no fragment); `newRefreshValue(rowId: string): string`; `parseRefresh(v: string): { rowId: string } | null`.
- Produces, schema: `agent_tokens` gains `kind TEXT NOT NULL DEFAULT 'pat'`, `client_id TEXT`, `access_expires_at INTEGER`, `refresh_hash TEXT`, `prev_refresh_hash TEXT`, `refreshed_at INTEGER` (no new index). `oauth_clients (id TEXT PRIMARY KEY, secret_hash TEXT NOT NULL, auth_method TEXT NOT NULL, name TEXT NOT NULL, redirect_uris TEXT NOT NULL, created_at INTEGER NOT NULL) WITHOUT ROWID`. `oauth_codes (code_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, client_id TEXT NOT NULL, label TEXT NOT NULL, redirect_uri TEXT NOT NULL, code_challenge TEXT NOT NULL, scopes TEXT NOT NULL, days INTEGER NOT NULL, expires_at INTEGER NOT NULL) WITHOUT ROWID`.
- Produces: `unauthorized(opts?: { invalidToken?: boolean }): Response`, whose header is `Bearer resource_metadata="<PRM_URL>"`, plus `, error="invalid_token"` when a header was presented. `tokenJson` gains `kind: 'pat' | 'oauth'`.
- Produces, `tests/lib/agent.ts`: `mintConnection(db, userId, scopes, opts?: { id?, label?, clientId?, accessExpiresAt?, expiresAt?, revokedAt? }): Promise<{ id: string; access: string; refresh: string }>`.

- [ ] **Step 1: Write the failing tests** in `tests/oauth-core.test.ts`:
  - `oauth access token on /api/mcp authenticates with the connection's rights` — `mintConnection(db,'ed',['cms.etkinlikler:draft'])`; `authenticateAgent(req('POST','/api/mcp',bearer(access)))` is `kind: 'agent'`, `agent.tokenId === id`, `agentGroupRights(agent,'draft').etkinlikler.edit === true`, approve false.
  - `oauth access token after access_expires_at is 401 invalid_token and writes no failure` — status 401, `WWW-Authenticate` contains `error="invalid_token"` and `resource_metadata="https://rsg-turkiye.iscbsc.org/.well-known/oauth-protected-resource/api/mcp"`; `agent_counters` has no `:i:` or `:g:failures` row.
  - `oauth access token on a REST table route is 401` — `GET /api/cms/drafts` with it: 401, handler not reached.
  - `oauth access token on a route outside the table is 403 human_only from the middleware` — `GET /api/admin/users`.
  - `a revoked connection is 401` — `revokedAt` set.
  - `no Authorization header on /api/mcp is 401 with resource_metadata and no error param` — through `functions/api/mcp.ts` `onRequestPost`.
  - `PAT behaviour is unchanged` — a PAT still authenticates on `/api/cms/drafts`; `newTokenValue()` still matches `/^rsg_pat_[A-Za-z0-9_-]{43}$/`.
  - `creating a 5th personal token ignores live connections` — 5 live connections plus 4 PATs: POST `/api/agent-tokens` is 201.
  - `GET /api/agent-tokens lists connections with kind oauth and no hash fields` — no key named `token_hash`, `refresh_hash`, `prev_refresh_hash`, `client_id` in the JSON.
  - `prune deletes expired codes and unused DCR clients older than a day` — a code with `expires_at < now`, a client created two days ago with no `agent_tokens.client_id` and no code referencing it: both gone; a client referenced by a live connection stays; the `audit.prune` details carry `oauthCodes` and `oauthClients` counts.
  - `isCanonicalResource` — true for `https://rsg-turkiye.iscbsc.org/api/mcp` and `HTTPS://RSG-TURKIYE.ISCBSC.ORG/api/mcp`; false for a trailing slash, `/api/mcp?x=1`, `#f`, `http://…`, another host.
  - `parseRefresh(newRefreshValue(id))` returns `{ rowId: id }`; a value with another prefix or a bad uuid returns null.

- [ ] **Step 2: Run them, expect failures**

Run: `node --import tsx --test tests/oauth-core.test.ts`
Expected: FAIL (`oauth-config` not found).

- [ ] **Step 3: Schema.** Add the columns to `CREATE TABLE agent_tokens`, the two tables (with comments: why WITHOUT ROWID, what prunes them), and note **8n**: run first `wrangler d1 execute rsg-members --remote --command="ALTER TABLE agent_tokens ADD COLUMN kind TEXT NOT NULL DEFAULT 'pat'; ALTER TABLE agent_tokens ADD COLUMN client_id TEXT; ALTER TABLE agent_tokens ADD COLUMN access_expires_at INTEGER; ALTER TABLE agent_tokens ADD COLUMN refresh_hash TEXT; ALTER TABLE agent_tokens ADD COLUMN prev_refresh_hash TEXT; ALTER TABLE agent_tokens ADD COLUMN refreshed_at INTEGER"` (not idempotent: never re-run), then `wrangler d1 execute rsg-members --remote --file=db/schema.sql`. Say that without it every token request fails on "no such column: kind".

- [ ] **Step 4: `oauth-config.ts`** with the Interfaces above.

- [ ] **Step 5: `authenticateAgent`.** `VALUE` becomes `/^Bearer (rsg_(?:pat|oat)_[A-Za-z0-9_-]{43})$/`. After the revoked/expired check: a row whose `kind` does not match the value's prefix is 401; an `oauth` row with `access_expires_at <= now` is `refused(unauthorized({ invalidToken: true }))` with no failure count (stale, like revoked); an `oauth` row whose route is not `area === 'mcp'` is `refused(unauthorized({ invalidToken: true }))`. Every other step is unchanged. `unauthorized()` callers that had a header pass `{ invalidToken: true }`; the "no header" 401s in `mcp.ts` call it bare.

- [ ] **Step 6: Middleware.** `TOKEN` takes both prefixes; `lookup` treats an `oauth` row with an expired access token as `'dead'` (select `kind, access_expires_at` too).

- [ ] **Step 7: Token API.** `COLUMNS` adds `kind`; `tokenJson` returns `kind` (still field by field); the live-count subquery in `onRequestPost` adds `AND kind = 'pat'`; the insert names `kind` as `'pat'`.

- [ ] **Step 8: Prune.** In the same counted batch: `DELETE FROM oauth_codes WHERE expires_at < ?now`; `DELETE FROM oauth_clients WHERE created_at < ?now-86400 AND NOT EXISTS (SELECT 1 FROM agent_tokens t WHERE t.client_id = oauth_clients.id) AND NOT EXISTS (SELECT 1 FROM oauth_codes c WHERE c.client_id = oauth_clients.id)`; counts `oauthCodes`, `oauthClients` in the `audit.prune` details.

- [ ] **Step 9: Allowlist.** Add `functions/oauth/authorize.ts` and `functions/oauth/token.ts` to `ALLOWED` in `tests/agent-tokens.test.ts` (Tasks 4 and 5 import `areasHeld`, `parseScopes`, `formatScope`, `hashToken`); update the three exact-`'Bearer'` assertions to the new header.

- [ ] **Step 10: Run the whole suite and the type check**

Run: `npm test && npx astro check`
Expected: all pass, 0 errors.

- [ ] **Step 11: Commit**

```bash
git add db/schema.sql functions/_lib/oauth-config.ts functions/_lib/agent-tokens.ts functions/api/_middleware.ts functions/api/agent-tokens/index.ts functions/api/admin/audit/prune.ts tests/
git commit -m "Agent OAuth: a connection is an agent credential (schema 8n, access tokens on /api/mcp)"
```

---

### Task 2: Discovery documents and routing

**Files:**
- Create: `functions/.well-known/oauth-protected-resource.ts`, `functions/.well-known/oauth-protected-resource/api/mcp.ts`, `functions/.well-known/oauth-authorization-server.ts`, `functions/_lib/oauth-metadata.ts`
- Modify: `public/_routes.json`, `functions/api/mcp.ts` (`VERSIONS`)
- Test: `tests/oauth-discovery.test.ts`; `tests/mcp.test.ts` (version)

**Interfaces:**
- Consumes: `ISSUER`, `MCP_RESOURCE` from `oauth-config.ts`; `CMS_GROUPS` from `functions/_lib/roles.ts`.
- Produces, in `oauth-metadata.ts` (which does not import `agent-tokens.ts`, so it stays off the import allowlist): `SCOPES_SUPPORTED: readonly string[]` (the twelve `cms.<group>:read|draft` and `social:read|draft` strings, built from `CMS_GROUPS`; the test checks each passes `parseScopes`), `protectedResourceMetadata(): object`, `authorizationServerMetadata(): object`, `cors(res: Response): Response`, `preflight(): Response`.

- [ ] **Step 1: Failing tests** in `tests/oauth-discovery.test.ts`:
  - `PRM at both paths is the same JSON` — `resource === 'https://rsg-turkiye.iscbsc.org/api/mcp'`, `authorization_servers` deep-equals `['https://rsg-turkiye.iscbsc.org']`, `bearer_methods_supported` `['header']`, `scopes_supported` has 12 entries each accepted by `parseScopes([s])`, `resource_name` `'RSG-Türkiye'`; `Content-Type` `application/json`; `Access-Control-Allow-Origin: *`; `Cache-Control: public, max-age=3600`.
  - `AS metadata advertises what Claude and ChatGPT check` — `issuer` equals the PRM's `authorization_servers[0]` exactly; `authorization_endpoint` `…/oauth/authorize`; `token_endpoint` `…/oauth/token`; `registration_endpoint` `…/oauth/register`; `response_types_supported ['code']`; `grant_types_supported ['authorization_code','refresh_token']`; `code_challenge_methods_supported ['S256']`; `token_endpoint_auth_methods_supported ['none','client_secret_basic','client_secret_post']`; `client_id_metadata_document_supported: true`; `authorization_response_iss_parameter_supported: true`; `scopes_supported` the same 12; no `offline_access` anywhere.
  - `OPTIONS on each answers 204 with CORS headers`.
  - `_routes.json includes the oauth and well-known paths and nothing broader` — `include` contains `/oauth/*`, `/.well-known/oauth-protected-resource`, `/.well-known/oauth-protected-resource/*`, `/.well-known/oauth-authorization-server`, and not `/.well-known/*`.
  - In `tests/mcp.test.ts`: `initialize asking 2025-11-25 gets 2025-11-25`, and a later message with header `MCP-Protocol-Version: 2025-11-25` is not 400.

- [ ] **Step 2: Run, expect failures.** `node --import tsx --test tests/oauth-discovery.test.ts tests/mcp.test.ts`

- [ ] **Step 3: Implement** `oauth-metadata.ts` and the three thin route files (`onRequestGet`, `onRequestOptions`); add the four `include` entries to `public/_routes.json`; `VERSIONS = ['2025-06-18', '2025-11-25', '2025-03-26']` (first stays preferred).

- [ ] **Step 4: Run the tests.** Same command. Expected: PASS.

- [ ] **Step 5: Verify the dot directory routes on a local Pages server**

Run: `npm run build && npx wrangler pages dev dist --port 8788` then `curl -si http://localhost:8788/.well-known/oauth-protected-resource/api/mcp` and `curl -si http://localhost:8788/.well-known/oauth-authorization-server` and `curl -si -X POST http://localhost:8788/api/mcp -H 'Content-Type: application/json' -d '{}'`
Expected: 200 JSON from the first two (not the Astro 404 page); the third 401 with `WWW-Authenticate: Bearer resource_metadata="…"`. If the first two 404, stop and report: the fallback is static files in `public/.well-known/` with `Content-Type` set in `public/_headers`, which needs a controller decision (the path-suffixed document then cannot share a name with the root one).

- [ ] **Step 6: Check nothing ignores the dot directory**

Run: `git check-ignore -v functions/.well-known/oauth-authorization-server.ts; git status --short functions/.well-known`
Expected: no output from `check-ignore`; the three files listed as new.

- [ ] **Step 7: Commit**

```bash
git add functions/.well-known functions/_lib/oauth-metadata.ts public/_routes.json functions/api/mcp.ts tests/oauth-discovery.test.ts tests/mcp.test.ts
git commit -m "Agent OAuth: protected resource and authorization server metadata"
```

---

### Task 3: The OAuth library (clients, redirect rules, CIMD, codes, limits)

**Files:**
- Create: `functions/_lib/oauth-clients.ts`, `functions/_lib/oauth-codes.ts`
- Modify: `functions/_lib/agent-limits.ts` (append only: `RevokeReason`, `chargeConnection`, `registrationRefusal`, `registrationBumps`)
- Test: `tests/oauth-clients.test.ts`, `tests/oauth-codes.test.ts`, `tests/oauth-limits.test.ts`

**Interfaces:**
- Consumes: `oauth-config.ts` (Task 1); `readSnapshot`, `ipRefusal`, `ipKey`, `rateLimited`, `agentBudgetSpent`, `LIMITS` and the private `bumpToken`/`bump` in `agent-limits.ts`.
- Produces, `oauth-clients.ts`:
  - `type Client = { id: string; name: string; host: string; redirectUris: string[]; kind: 'cimd' | 'dcr'; authMethod: 'none' | 'client_secret_basic' | 'client_secret_post'; secretHash: string | null }` (`host`: for CIMD the `client_id` URL's host; for DCR the first redirect URI's host, or its scheme for a custom scheme).
  - `redirectUriProblem(uri: string): string | null` (Call 9).
  - `redirectMatches(registered: string[], asked: string): boolean` (exact, except loopback `http` compared without the port).
  - `isLoopbackOrCustom(uri: string): boolean` (for the consent warning).
  - `resolveClient(db: D1Database, clientId: string, fetcher?: typeof fetch): Promise<Client | { error: 'unknown_client' | 'bad_metadata' }>` (CIMD by Call 10 when `clientId` starts with `https://`, a DCR row when it starts with `rsg_oc_`, anything else `unknown_client`).
  - `parseRegistration(body: unknown): { ok: true; name: string; redirectUris: string[]; authMethod: Client['authMethod'] } | { ok: false; error: 'invalid_redirect_uri' | 'invalid_client_metadata'; description: string }` (`grant_types` ⊆ `authorization_code`, `refresh_token`; `response_types` ⊆ `code`; unknown fields ignored, never fetched).
  - `registerStatement(db, input): { statement: D1PreparedStatement; id: string; secret: string }`.
  - `authenticateClient(client: Client, presented: { id: string; secret: string | null; via: 'basic' | 'post' | 'none' }): boolean` (CIMD: no secret allowed; DCR: a presented secret must match by `safeEqual` on hashes; no secret only when `authMethod === 'none'`).
- Produces, `oauth-codes.ts`:
  - `createCode(db, input: { userId; clientId; label; redirectUri; codeChallenge; scopes: string[]; days: number }, now: number): Promise<string | null>` (one batch: delete this member's expired codes; insert guarded by `(SELECT COUNT(*) FROM oauth_codes WHERE user_id = ? AND expires_at > ?) < MAX_LIVE_CODES`; null when full).
  - `consumeCode(db, code: string, now: number): Promise<CodeRow | null>` (`DELETE … WHERE code_hash = ? AND expires_at > ? RETURNING *`, single use, as `consumeState` in `oauth-state.ts`).
  - `pkceMatches(verifier: string, challenge: string): Promise<boolean>` (verifier 43 to 128 of `[A-Za-z0-9._~-]`; base64url SHA-256, no padding).
- Produces, `agent-limits.ts`:
  - `RevokeReason` adds `'refresh_reuse'`.
  - `chargeConnection(db, c: { tokenId: string; userId: string; social: boolean }, ip: string, now: number): Promise<Response | null>` (Call 7: IP cut-off, member day, pools with reserve when `social`, minute limit and flood revoke as `checkToken`; one `bumpToken` upsert when allowed; no body checks; a refusal is 429 JSON `{ error: 'rate_limited' }` with `Retry-After`, or the `agent_budget` answer).
  - `registrationRefusal(db, ip, now): Promise<Response | null>` (reads `<day>:r:<ip>` and `<day>:g:registrations` by primary key in one statement; 429 at 10 or 200).
  - `registrationBumps(db, ip, now): D1PreparedStatement[]` (the two upserts, to batch with the client insert).

- [ ] **Step 1: Failing tests.**
  - `redirectUriProblem` accepts `https://claude.ai/api/mcp/auth_callback`, `https://chatgpt.com/connector_platform_oauth_redirect`, `http://127.0.0.1:33418`, `http://localhost:7777/oauth/callback`, `http://[::1]:9/cb`, `cursor://anysphere.cursor-mcp/oauth/callback`; refuses `http://example.org/cb`, `javascript:alert(1)`, `data:text/html,x`, `file:///x`, `https://a.example/cb#f`, a 513-character URI, `''`.
  - `redirectMatches(['http://127.0.0.1/callback'], 'http://127.0.0.1:51234/callback')` true; `(['http://localhost/callback'], 'http://localhost:3118/callback')` true; `(['https://claude.ai/api/mcp/auth_callback'], 'https://claude.ai/api/mcp/auth_callback/')` false; `(['http://127.0.0.1/callback'], 'http://127.0.0.1:5/other')` false.
  - CIMD with `stubHttp(['claude.example'], …)`: a good document resolves (`kind 'cimd'`, `host 'claude.example'`, no D1 row written); each of these is `bad_metadata` and writes nothing: a 302, a 5 s hang (fake timer or an aborted signal), 17 KB, `text/html`, a document whose `client_id` differs by one character, `redirect_uris` empty; and `http://claude.example/x`, `https://claude.example` (no path), `https://192.0.2.1/x`, `https://rsg-turkiye.iscbsc.org/x` are refused without any fetch (`calls.length === 0`).
  - `parseRegistration` defaults `authMethod` to `client_secret_basic`; refuses `grant_types: ['client_credentials']`, six redirect URIs, a bad one (`invalid_redirect_uri`).
  - `authenticateClient`: DCR `none` with no secret true; DCR `client_secret_basic` with no secret false; wrong secret false; CIMD with any secret false.
  - Codes: `consumeCode` returns the row once and null the second time; null after `CODE_TTL`; `createCode` returns null for the 6th live code and succeeds after one expires; `pkceMatches` against RFC 7636 Appendix B (`dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk` → `E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM`).
  - Limits: `chargeConnection` refuses with no counter write when the member has 300 today; refuses `agent_budget` when the general pool is spent and `social` false, allows from the reserve when `social` true; writes exactly one counter row when allowed; `registrationRefusal` is 429 for the 11th from one IP and the 201st overall, and the refused call leaves `agent_counters` byte-for-byte unchanged.

- [ ] **Step 2: Run, expect failures.** `node --import tsx --test tests/oauth-clients.test.ts tests/oauth-codes.test.ts tests/oauth-limits.test.ts`

- [ ] **Step 3: Implement** the three modules to the Interfaces. CIMD fetch: `fetcher(url, { redirect: 'manual', signal: AbortSignal.timeout(5000), headers: { Accept: 'application/json' } })`, refuse any non-200, stream with a running byte count (as `readCounted`), `JSON.parse`. Registration and IP keys use `ipKey(request)` like plan 5 and the same `<day>:` key prefix, so the nightly prune already deletes them.

- [ ] **Step 4: Run the tests.** Expected: PASS. Then `npm test`.

- [ ] **Step 5: Commit**

```bash
git add functions/_lib/oauth-clients.ts functions/_lib/oauth-codes.ts functions/_lib/agent-limits.ts tests/oauth-clients.test.ts tests/oauth-codes.test.ts tests/oauth-limits.test.ts
git commit -m "Agent OAuth: clients (CIMD, DCR), redirect rules, codes and limits"
```

---

### Task 4: Authorize and the consent screen

**Files:**
- Create: `functions/oauth/authorize.ts`, `functions/_lib/oauth-consent.ts`
- Modify: `functions/_lib/next-path.ts`
- Test: `tests/oauth-authorize.test.ts`; `tests/next-path.test.ts` (extend)

**Interfaces:**
- Consumes: `resolveClient`, `redirectMatches`, `isLoopbackOrCustom` (Task 3); `createCode` (Task 3); `areasHeld`, `parseScopes`, `formatScope` (`agent-tokens.ts`); `getSessionUser`, `checkCsrf` (`auth.ts`); `activeGrants` (`role-grants.ts`); `ISSUER`, `isCanonicalResource`, `CONNECTION_DAYS`, `DEFAULT_DAYS`, `MAX_CONNECTIONS` (Task 1).
- Produces: `onRequestGet`, `onRequestPost` in `functions/oauth/authorize.ts`; `consentPage(v: ConsentView): string`, `errorPage(lang: 'tr' | 'en', key: ErrorKey): string`, `consentLang(request: Request, param: string | null): 'tr' | 'en'` in `oauth-consent.ts`.

The flow (GET and POST validate the same way, in this order):
1. No session: GET answers 302 to `/auth/login?next=` + the encoded `/oauth/authorize?…` (a query over 2,048 characters gets the error page); POST answers the 400 error page. The session comes first so an anonymous request never makes the Function fetch a CIMD URL (Review Focus 5).
2. `client_id` resolves and `redirect_uri` is present and `redirectMatches`: otherwise the error page (400), never a redirect.
3. `response_type === 'code'`, `code_challenge` 43 to 128 of `[A-Za-z0-9._~-]`, `code_challenge_method === 'S256'`, `state` at most 512 characters if present, `resource` absent or `isCanonicalResource`: otherwise 303 to the redirect URI with `error=invalid_request` (or `invalid_target` for `resource`), `state`, `iss`.
4. GET renders the consent page: the client's name marked as "as the app calls itself", the `client_id` host for CIMD, where the code will go (Call 9, with the warning), one checkbox and level select per area in `areasHeld(liveRoles)` (pre-ticked per Call 5), the life select (7, 30, 90 days, 30 selected), the fixed text "It can read and write drafts in your name. It can never approve, publish, schedule or send." in both languages, Allow and Deny buttons, the language link, and every OAuth parameter as hidden fields. No area held: a page that says so, with Deny only. 5 live connections: a page that says to disconnect one in the panel (link `/admin#anahtarlar`), with Deny only.
5. POST: `checkCsrf`; `action=deny` answers 303 `error=access_denied`; `action=allow` parses the ticked `area:level` pairs with `parseScopes`, refuses any area not in `areasHeld` (400 page), refuses `days` not in `CONNECTION_DAYS` (400 page), `createCode` (null: 400 page "too many pending sign-ins, wait two minutes") and answers 303 to `redirect_uri` with `code`, `state` (if sent), `iss`.

- [ ] **Step 1: Failing tests** (`stubHttp` serves a CIMD document for `claude.example` with redirect `https://claude.example/cb`):
  - `unknown client or unregistered redirect shows the error page and never redirects` (signed in) — status 400, no `Location`, body contains no part of the asked `redirect_uri`.
  - `signed out, a CIMD client_id is never fetched` — `stubHttp` records zero calls before sign-in.
  - `a bad code_challenge_method redirects 303 with error, state and iss` — `Location` query `error=invalid_request`, `state=xyz`, `iss=https://rsg-turkiye.iscbsc.org`.
  - `a resource other than the MCP URL is invalid_target`.
  - `signed out, GET redirects to Google sign-in carrying the whole request` — `Location` starts `/auth/login?next=%2Foauth%2Fauthorize%3F`, and `safeNext` of the decoded value is that value; D1 has no new row in any table.
  - `signed in, GET shows only the areas the member holds, pre-ticked from the requested scope` — member holds `content.etkinlikler.edit` only; scope `cms.etkinlikler:draft social:draft cms.yazilar:read`: the page has one area input (`cms.etkinlikler`), ticked, level `draft`; no `social`; contains the redirect host `claude.example`; contains `approve` text only in the "can never" sentence; headers `X-Frame-Options: DENY`, `Cache-Control: no-store`.
  - `Turkish when Accept-Language is tr, English otherwise, and rsg_lang overrides`.
  - `a loopback or custom-scheme redirect shows the warning and the whole URI`.
  - `Allow answers 303 (never 307) with code, state and iss, and stores one code row` — `oauth_codes` has one row with the ticked scopes JSON and `days`.
  - `Deny answers 303 access_denied and writes nothing`.
  - `a forged POST asking for an area the member does not hold is a 400 page and writes nothing`.
  - `a POST from another origin is refused (checkCsrf)`.
  - `the 6th live connection's GET shows the disconnect-one page`.
  - `every member-supplied or client-supplied string is escaped` — a CIMD `client_name` of `<img src=x onerror=alert(1)>` appears only escaped.
  - next-path: `safeNext('/oauth/authorize?response_type=code&client_id=https%3A%2F%2Fclaude.example%2Fc')` returns it; `'/oauth/authorize/../admin'`, `'/oauth/authorizex'`, `'//evil.example/oauth/authorize'` and a 2,049-character value return null; the `/admin` cases keep their 512 limit.

- [ ] **Step 2: Run, expect failures.** `node --import tsx --test tests/oauth-authorize.test.ts tests/next-path.test.ts`

- [ ] **Step 3: Implement.** `ALLOWED` in `next-path.ts` becomes `/^\/(?:(?:tr\/)?(?:admin|account)(?:\/|$)|oauth\/authorize$)/` with the length limit 2,048 for `/oauth/authorize` and 512 otherwise. The page uses inline CSS only (white card, navy text, the panel's system font stack, buttons at least 44 px high), no script, no external request, no em dash.

- [ ] **Step 4: Run the tests.** Expected: PASS. Then `npm test && npx astro check`.

- [ ] **Step 5: Commit**

```bash
git add functions/oauth/authorize.ts functions/_lib/oauth-consent.ts functions/_lib/next-path.ts tests/oauth-authorize.test.ts tests/next-path.test.ts
git commit -m "Agent OAuth: authorize and the consent screen"
```

---

### Task 5: The token endpoint

**Files:**
- Create: `functions/oauth/token.ts`
- Test: `tests/oauth-token.test.ts`

**Interfaces:**
- Consumes: `resolveClient`, `authenticateClient` (Task 3), `consumeCode`, `pkceMatches` (Task 3), `chargeConnection`, `autoRevoke`, `countFailedAuth`, `readSnapshot`, `ipRefusal`, `ipKey` (`agent-limits.ts`), `runGuardedWithAudit` (`audit.ts`), `hashToken` (`agent-tokens.ts`), `oauth-config.ts`, `cors`/`preflight` (Task 2).
- Produces: `onRequestPost`, `onRequestOptions`. Answers: 200 `{ access_token, token_type: 'Bearer', expires_in, refresh_token, scope }` with `Cache-Control: no-store`; errors `{ error, error_description }` as RFC 6749 §5.2: `invalid_request` 400, `invalid_client` 401 (with `WWW-Authenticate: Basic realm="rsg-turkiye"` when Basic was used), `invalid_grant` 400, `unsupported_grant_type` 400, `invalid_target` 400; 429 per Call 7.

Order of checks: method, `Content-Type` form (else 400), body at most 8 KB; IP cut-off (`readSnapshot` + `ipRefusal`, no write); client authentication (Basic header decoded and URL-decoded per RFC 6749 §2.3.1, or `client_id`/`client_secret` in the body, not both); then the grant.

- `authorization_code`: generate the new row id, then `chargeConnection` for it (with the member and `social` read from the code row by a plain `SELECT … WHERE code_hash = ? AND expires_at > ?`) **before** `consumeCode`, so a refusal writes nothing and the code stays redeemable; then `consumeCode`; the code's `client_id` equals the authenticated client, `redirect_uri` equals the code's, `pkceMatches`, `resource` absent or canonical; insert the `agent_tokens` row (`kind 'oauth'`, `label` = `<client name> (<host>)` cut to 60, `hint ''`, `scopes`, `expires_at = now + days·86400`, `token_hash` of a new access value, `access_expires_at = now + ACCESS_TTL`, `refresh_hash` of `newRefreshValue(id)`, `refreshed_at = now`, `client_id`), guarded by `(SELECT COUNT(*) … WHERE user_id = ? AND kind = 'oauth' AND revoked_at IS NULL AND expires_at > ?) < MAX_CONNECTIONS`, with its `agent_token.create` audit row in one `runGuardedWithAudit`.
- `refresh_token`: `parseRefresh`, select the row by id; `kind 'oauth'`, live, client matches the row's `client_id`; its hash equals `refresh_hash`: one `UPDATE … SET token_hash, access_expires_at = min(now + ACCESS_TTL, expires_at), refresh_hash, prev_refresh_hash = refresh_hash, refreshed_at WHERE id = ? AND refresh_hash = ? AND revoked_at IS NULL` whose `changes()` must be 1 (a lost race is `invalid_grant`); equals `prev_refresh_hash`: Call 6; anything else `invalid_grant` with a failed authentication counted. `chargeConnection` runs before the UPDATE (a refusal writes nothing). `expires_in` is the seconds to `access_expires_at`. A `scope` parameter is ignored.

- [ ] **Step 1: Failing tests** (helpers: `mintConnection` from Task 1; a direct `oauth_codes` insert for code tests; a DCR client via `registerStatement`):
  - `code exchange issues tokens that work at /api/mcp` — `tools/list` with the access token answers the tools of the consented scope only; response has `token_type 'Bearer'`, `expires_in 3600`, `scope` equal to the code's scopes joined by spaces, `refresh_token` matching `^rsg_ort_[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$`; one `agent_token.create` audit row with `details.kind === 'oauth'` and no token value anywhere in `audit_log`.
  - `the code works once` — second exchange `invalid_grant`, still one `agent_tokens` row.
  - `wrong verifier, other client, other redirect_uri, expired code, non-canonical resource` — each `invalid_grant` (or `invalid_target`), no `agent_tokens` row, failures counted (2 rows each).
  - `JSON body is 400 invalid_request` and `a 9 KB body is 400`.
  - `refresh rotates in place` — same row id, new `token_hash`, the old access token 401 at `/api/mcp`, the new one works, the old refresh is `prev_refresh_hash`.
  - `old refresh within 60 s is invalid_grant and the connection lives; after 60 s it revokes with one auto_revoke row` (`reason: 'refresh_reuse'`), and the current refresh then fails too.
  - `two refreshes racing with one value rotate once` — run both before awaiting; one 200, one `invalid_grant`.
  - `refresh of a disconnected connection is invalid_grant` — after `DELETE /api/agent-tokens/:id` by its member.
  - `refresh after the connection's life ends is invalid_grant`, and `expires_in` never runs past `expires_at`.
  - `confidential DCR client: Basic and post both work, a wrong secret is 401 invalid_client with WWW-Authenticate Basic`.
  - `a 6th connection's exchange is invalid_grant and writes no row`.
  - `a member at 300 requests today gets 429 rate_limited with Retry-After and no write`, on both grants; after the exchange's 429 the same code still redeems once the day resets (advance `now`).
  - `Content-Type: application/x-www-form-urlencoded;charset=UTF-8 is accepted` (prefix match).
  - `the D1 rows written by an exchange and a refresh stay within the Global Constraints table` — count rows changed across all tables (`sqlite` `total_changes()` or a before/after snapshot): exchange ≤ 9, refresh ≤ 5 (index entries are not visible in node:sqlite; this pins the row count and the reviewer checks the index arithmetic).

- [ ] **Step 2: Run, expect failures.** `node --import tsx --test tests/oauth-token.test.ts`

- [ ] **Step 3: Implement** to the order above.

- [ ] **Step 4: Run the tests.** Expected: PASS. Then `npm test`.

- [ ] **Step 5: Commit**

```bash
git add functions/oauth/token.ts tests/oauth-token.test.ts
git commit -m "Agent OAuth: token endpoint with refresh rotation and reuse detection"
```

---

### Task 6: Dynamic client registration

**Files:**
- Create: `functions/oauth/register.ts`
- Test: `tests/oauth-register.test.ts`

**Interfaces:**
- Consumes: `parseRegistration`, `registerStatement` (Task 3); `registrationRefusal`, `registrationBumps`, `ipKey` (Task 3 / plan 5); `cors`, `preflight` (Task 2).
- Produces: `onRequestPost`, `onRequestOptions`. 201 `{ client_id, client_secret, client_id_issued_at, client_secret_expires_at: 0, client_name, redirect_uris, grant_types: ['authorization_code','refresh_token'], response_types: ['code'], token_endpoint_auth_method }`; errors 400 `{ error: 'invalid_redirect_uri' | 'invalid_client_metadata', error_description }` (RFC 7591 §3.2.2); 429 per Task 3 with `Retry-After`; `Cache-Control: no-store`.

Order: `Content-Type: application/json` (else 400), body at most 8 KB as a capped stream read (`readCapped`), `registrationRefusal` (no write), `parseRegistration`, one batch of `registerStatement` + `registrationBumps`.

- [ ] **Step 1: Failing tests:**
  - `a Cursor-style registration with three redirect URIs, one custom scheme and two loopback, is 201` with a `client_id` starting `rsg_oc_`, a `client_secret` starting `rsg_ocs_`, `token_endpoint_auth_method` echoing the request, and the stored row has a hash, not the secret.
  - `no token_endpoint_auth_method means client_secret_basic`; `none` still returns a secret (Call 8).
  - `the 11th registration from one IP and the 201st of the day are 429 and write nothing` (snapshot of all tables equal before and after).
  - `a bad redirect URI is 400 invalid_redirect_uri and writes nothing`; `a 9 KB body is 400`; `form-encoded is 400`.
  - `logo_uri, client_uri, jwks_uri and tos_uri are ignored and never fetched` (`stubHttp` with no hosts records zero calls).
  - `the registered client can complete authorize and token` — register, then `resolveClient` finds it with the same redirect URIs.

- [ ] **Step 2: Run, expect failures.** `node --import tsx --test tests/oauth-register.test.ts`

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Run the tests.** Expected: PASS. Then `npm test`.

- [ ] **Step 5: Commit**

```bash
git add functions/oauth/register.ts tests/oauth-register.test.ts
git commit -m "Agent OAuth: dynamic client registration, capped and rate limited"
```

---

### Task 7: Connected apps in the panel, and the help box

**Files:**
- Modify: `src/scripts/admin/sections/tokens.ts`, `src/components/admin/panes/TokensPane.astro`, `src/i18n/ui.ts` (both languages), `src/lib/audit-labels.ts` (only if a test shows a missing label; `agent_token.*` codes exist)
- Test: `tests/browser/agent-tokens.mjs` (extend); `tests/admin-sections.test.ts` (the only unit test that names `admin.tokens`) must still pass; the en/tr key pairing is checked by the `admin-*-i18n.test.ts` pattern, so add `tests/admin-tokens-i18n.test.ts`: every new `admin.tokens.connect.*` / `.apps.*` key exists in both languages, and no value contains U+2014

**Interfaces:**
- Consumes: `GET /api/agent-tokens` rows with `kind` (Task 1); `DELETE /api/agent-tokens/:id` (plan 5, unchanged).
- Produces: none for other tasks.

What the member sees, in this order in the section:
1. The existing intro.
2. **Help box** (a plain bordered block, heading "Claude'a bağla / ChatGPT'ye bağla" in the page language). Two ordered lists:
   - Claude: open claude.ai, Customize, Connectors, Add custom connector; paste `https://rsg-turkiye.iscbsc.org/api/mcp`; leave the OAuth settings empty; Add, then Connect; sign in with Google here, tick the areas and levels, choose how long, Allow. It then works in the Claude desktop and mobile apps too. Free plans allow one custom connector; on Team and Enterprise an Owner adds it first.
   - ChatGPT: in ChatGPT on the web, Settings, Apps, Advanced settings, turn on Developer mode; Create app; paste the same address; Authentication: OAuth; sign in here and Allow. Which ChatGPT plans allow it, and whether it may write, depends on the plan.
   - One closing line: "Menu names change from time to time; the address and the sign-in stay the same." No screenshots.
3. "Ajan anahtarları / My tokens": `kind === 'pat'` rows, unchanged.
4. "Bağlı uygulamalar / Connected apps": `kind === 'oauth'` rows: title is the label ("Claude (claude.ai)"), chips for status and scopes, meta "connected {date}, ends {date}, last used {date}", a "Bağlantıyı kes / Disconnect" button with the same two-click confirm as Revoke. Empty: "No app is connected yet."
5. Admin's "Everyone's tokens" shows both kinds, with a chip "Uygulama / App" on `oauth` rows.
6. A revoked connection shows "revoked automatically" when `revoke_reason` is `refresh_reuse`, `flood`, `refusals` or `leaked`.

New keys (en and tr each, no em dash): `admin.tokens.connect.heading`, `.claude.heading`, `.claude.step1` … `.claude.step5`, `.claude.plans`, `.chatgpt.heading`, `.chatgpt.step1` … `.chatgpt.step4`, `.chatgpt.plans`, `.menusChange`; `admin.tokens.apps.heading`, `.none`, `.disconnect`, `.disconnectConfirm`, `.disconnected`, `.disconnectFailed`, `.row.connected`; `admin.tokens.kind.app`; `admin.tokens.row.revokedAuto`.

- [ ] **Step 1: Failing browser checks** in `tests/browser/agent-tokens.mjs` (mocked `/api/agent-tokens` returning one `pat` and one `oauth` row):
  - the help box is visible with both headings and the MCP address as text;
  - the connection is in "Connected apps", not in "My tokens"; its Disconnect needs two clicks and then sends `DELETE /api/agent-tokens/<id>`; the row turns "Revoked" after the refreshed list;
  - the admin list shows the App chip;
  - Turkish page (`/tr/admin#anahtarlar`) shows "Bağlı uygulamalar" and "Claude'a bağla";
  - no horizontal scroll at 390 px; no inner scrollbar at the six desktop sizes.

- [ ] **Step 2: Run, expect failures**

Run: `npm run build && (npm run preview &) && node tests/browser/agent-tokens.mjs`
Expected: the new checks print ✗.

- [ ] **Step 3: Implement** in `tokens.ts` (split the list by `kind`, reuse `tokenRow` with a `kind` flag for the button text and meta) and `TokensPane.astro` (the help box and the second list's host), strings in `ui.ts`.

- [ ] **Step 4: Run the checks and the suite**

Run: `node tests/browser/agent-tokens.mjs && node tests/browser/admin-overflow.mjs && node tests/browser/admin-fit-viewport.mjs && npm test && npx astro check`
Expected: all ✓, 0 errors.

- [ ] **Step 5: Show the owner** a local preview link of `/admin#anahtarlar` and `/tr/admin#anahtarlar` (signed in, mocked as in the browser test) and wait for approval before the commit is pushed.

- [ ] **Step 6: Commit**

```bash
git add src/scripts/admin/sections/tokens.ts src/components/admin/panes/TokensPane.astro src/i18n/ui.ts tests/browser/agent-tokens.mjs tests/admin-tokens-i18n.test.ts
git commit -m "Panel: connected apps with disconnect, and how to connect Claude or ChatGPT"
```

---

### Task 8: End to end, documentation, and the live checklist

**Files:**
- Create: `tests/oauth-flow.test.ts`, `tests/browser/oauth-consent.mjs`
- Modify: `README.md` ("Agent access": a new subsection "Connecting Claude, ChatGPT and other apps"; the routes and Limits subsections), `CLAUDE.md` ("Where things live" agent row; "Data and the free tier" agent bullet), `functions/_lib/agent-instructions.ts` (first sentence: "through their personal token or an app connection they approved"), `tests/mcp.test.ts` if the length check needs it

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Write the end-to-end test** `tests/oauth-flow.test.ts`, one test per client shape, each walking the real handlers in-process from the 401 to a tool call:
  - `Claude shape (CIMD, public client)`: POST `/api/mcp` without a token gives 401 with `resource_metadata`; GET that URL; GET the AS metadata; GET `/oauth/authorize` signed out (302 to login), signed in (consent page); POST Allow; POST `/oauth/token` with the code, verifier and `resource=https://rsg-turkiye.iscbsc.org/api/mcp`; `initialize`, `tools/list`, one `tools/call` that creates a draft; the draft's `by_agent` is true and its audit row carries the connection's id; `revokeRole` the member's `content.etkinlikler.edit`, then `tools/list` has no `cms_` tool and the connection row is unchanged; grant it again; refresh; the panel's `GET /api/agent-tokens` lists the connection; `DELETE` it; the next MCP call is 401 and the refresh `invalid_grant`.
  - `ChatGPT shape`: as above with `client_id https://chatgpt.example/oauth/client.json` and redirect `https://chatgpt.example/connector_platform_oauth_redirect`; asserts the `iss` in the redirect equals the AS metadata `issuer`.
  - `Cursor shape (DCR, custom scheme)`: register, authorize to `cursor://…`, exchange with the secret omitted (`none`) and then with Basic.
  - `Approve is unreachable`: with a connection holding `cms.etkinlikler:draft` for a member who also holds `content.etkinlikler.approve`, no tool approves and `POST /api/cms/drafts/<id>/approve` with the access token is 403 `human_only`.

- [ ] **Step 2: Run it.** `node --import tsx --test tests/oauth-flow.test.ts` — Expected: PASS (all pieces exist). Fix in the owning task's files if not, and say so in the report.

- [ ] **Step 3: Browser check of the consent page** `tests/browser/oauth-consent.mjs`: render `consentPage()` output for a member with five areas, a long client name and a loopback redirect with `page.setContent`, in both languages, at the six desktop sizes and 390 px: no horizontal scroll, every control at least 44 px high, the warning visible without scrolling at 1280×680 when there are two areas. Run: `node tests/browser/oauth-consent.mjs`. Expected: all ✓. Show it to the owner with the panel preview (Task 7 Step 5).

- [ ] **Step 4: Documentation.** README: what a connection is (Calls 2, 4, 5), the three endpoints and two metadata URLs, the client table's "works" column in plain words (Claude and ChatGPT by CIMD; Cursor, VS Code, Raycast, Perplexity, Copilot Studio, Gemini CLI by DCR; Gemini Enterprise and Microsoft 365 Copilot need a pre-registered client, not supported), lifetimes, the rows-written table, how to disconnect, and that the personal token stays the way for terminals and scripts. CLAUDE.md: add `functions/oauth/`, `functions/.well-known/`, `functions/_lib/oauth-*.ts` to the agent row; add one sentence to the agent bullet: "An app connection (OAuth) is an agent credential in `agent_tokens` (`kind = 'oauth'`) and spends the same budgets; a refresh writes about 4 rows and counts as one request."

- [ ] **Step 5: The full gate**

Run: `npm test && npx astro check && npm run build`
Expected: all pass, 0 errors, build succeeds.

- [ ] **Step 6: Commit**

```bash
git add tests/oauth-flow.test.ts tests/browser/oauth-consent.mjs README.md CLAUDE.md functions/_lib/agent-instructions.ts tests/mcp.test.ts
git commit -m "Agent OAuth: end-to-end tests and documentation"
```

- [ ] **Step 7: Live checklist for the owner** (in the PR description; nothing here is done by an agent): apply migration 8n on the remote D1; deploy; in claude.ai add the custom connector with the MCP address, connect, consent with one read area, ask Claude to list drafts; disconnect in the panel and confirm Claude asks to reconnect; repeat in ChatGPT developer mode; check `wrangler d1 insights rsg-members --sort-type=sum --sort-by=writes --timePeriod=1d` the next day.

## Owner answers (2026-10-26)

1. Pre-registered clients (Gemini Enterprise, Microsoft 365 Copilot): not now. The OAuth target is ChatGPT and Claude; terminal and editor clients (Claude Code, Gemini CLI, Cursor, VS Code, Zed, Raycast) working through the same flow is welcome.
2. Native and desktop redirects (loopback, private-use schemes): allowed, with the warning on the consent screen.
3. OAuth access tokens work on /api/mcp only.
