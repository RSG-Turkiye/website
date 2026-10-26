// Discovery for the agent OAuth server (plan 6, Task 2): protected resource
// metadata (RFC 9728) at the root and path-suffixed well-known URLs, and
// authorization server metadata (RFC 8414), with what Claude and ChatGPT
// check before they pick a client identification method.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseScopes } from '../functions/_lib/agent-tokens';
import * as prmRoot from '../functions/.well-known/oauth-protected-resource';
import * as prmMcp from '../functions/.well-known/oauth-protected-resource/api/mcp';
import * as asMeta from '../functions/.well-known/oauth-authorization-server';

const SITE = 'https://rsg-turkiye.iscbsc.org';
type Handler = (c: unknown) => Response | Promise<Response>;
const call = (h: unknown, path: string, method = 'GET') =>
  (h as Handler)({ request: new Request(`${SITE}${path}`, { method }), env: {}, params: {}, waitUntil: () => {}, data: {} });

function assertDocHeaders(res: Response) {
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Content-Type'), 'application/json');
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), '*');
  assert.equal(res.headers.get('Cache-Control'), 'public, max-age=3600');
}

async function prm(mod: typeof prmRoot, path: string) {
  const res = await call(mod.onRequestGet, path);
  assertDocHeaders(res);
  return res.json() as Promise<Record<string, unknown>>;
}

test('PRM at both paths is the same JSON', async () => {
  const root = await prm(prmRoot, '/.well-known/oauth-protected-resource');
  const mcp = await prm(prmMcp, '/.well-known/oauth-protected-resource/api/mcp');
  assert.deepEqual(root, mcp);
  assert.equal(mcp.resource, 'https://rsg-turkiye.iscbsc.org/api/mcp');
  assert.deepEqual(mcp.authorization_servers, ['https://rsg-turkiye.iscbsc.org']);
  assert.deepEqual(mcp.bearer_methods_supported, ['header']);
  assert.equal(mcp.resource_name, 'RSG-Türkiye');
  const scopes = mcp.scopes_supported as string[];
  assert.equal(scopes.length, 12);
  assert.equal(new Set(scopes).size, 12);
  for (const s of scopes) assert.ok(parseScopes([s]), `${s} is a scope parseScopes accepts`);
});

test('AS metadata advertises what Claude and ChatGPT check', async () => {
  const res = await call(asMeta.onRequestGet, '/.well-known/oauth-authorization-server');
  assertDocHeaders(res);
  const text = await res.text();
  const as = JSON.parse(text) as Record<string, unknown>;
  const p = await prm(prmMcp, '/.well-known/oauth-protected-resource/api/mcp');
  // ChatGPT: issuer must equal the PRM's authorization_servers entry exactly.
  assert.equal(as.issuer, (p.authorization_servers as string[])[0]);
  assert.equal(as.authorization_endpoint, `${SITE}/oauth/authorize`);
  assert.equal(as.token_endpoint, `${SITE}/oauth/token`);
  assert.equal(as.registration_endpoint, `${SITE}/oauth/register`);
  assert.deepEqual(as.response_types_supported, ['code']);
  assert.deepEqual(as.grant_types_supported, ['authorization_code', 'refresh_token']);
  assert.deepEqual(as.code_challenge_methods_supported, ['S256']);
  // Claude: CIMD only when this is true and 'none' is listed.
  assert.deepEqual(as.token_endpoint_auth_methods_supported, ['none', 'client_secret_basic', 'client_secret_post']);
  assert.equal(as.client_id_metadata_document_supported, true);
  assert.equal(as.authorization_response_iss_parameter_supported, true);
  assert.deepEqual(as.scopes_supported, p.scopes_supported);
  assert.ok(!text.includes('offline_access'));
});

test('OPTIONS on each answers 204 with CORS headers', async () => {
  for (const [mod, path] of [
    [prmRoot, '/.well-known/oauth-protected-resource'],
    [prmMcp, '/.well-known/oauth-protected-resource/api/mcp'],
    [asMeta, '/.well-known/oauth-authorization-server'],
  ] as const) {
    const res = await call(mod.onRequestOptions, path, 'OPTIONS');
    assert.equal(res.status, 204, path);
    assert.equal(await res.text(), '');
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), '*');
    assert.equal(res.headers.get('Access-Control-Allow-Methods'), 'GET, POST, OPTIONS');
    assert.equal(res.headers.get('Access-Control-Allow-Headers'), 'Content-Type, Authorization, MCP-Protocol-Version');
  }
});

test('_routes.json includes the oauth and well-known paths and nothing broader', () => {
  const routes = JSON.parse(readFileSync(new URL('../public/_routes.json', import.meta.url), 'utf8')) as { include: string[] };
  for (const rule of ['/oauth/*', '/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/*', '/.well-known/oauth-authorization-server']) {
    assert.ok(routes.include.includes(rule), rule);
  }
  assert.ok(!routes.include.includes('/.well-known/*'));
  assert.ok(!routes.include.includes('/*'));
});
