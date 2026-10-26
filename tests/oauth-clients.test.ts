import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { d1 } from './lib/d1-sqlite';
import { stubHttp } from './lib/http';
import {
  authenticateClient, isLoopbackOrCustom, parseRegistration, redirectMatches, redirectUriProblem, registerStatement, resolveClient,
  type Client,
} from '../functions/_lib/oauth-clients';
import { sha256Hex } from '../functions/_lib/oauth-config';

const SCHEMA = readFileSync(new URL('../db/schema.sql', import.meta.url).pathname, 'utf8');
const NOW = 1_800_000_000;

function setup() {
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA);
  return { db, DB: d1(db) as never as D1Database };
}
const changes = (db: DatabaseSync) => (db.prepare('SELECT total_changes() AS n').get() as { n: number }).n;

// --- redirect URIs (Call 9) -------------------------------------------------

test('redirectUriProblem accepts https, loopback http and private-use schemes', () => {
  for (const uri of [
    'https://claude.ai/api/mcp/auth_callback',
    'https://chatgpt.com/connector_platform_oauth_redirect',
    'http://127.0.0.1:33418',
    'http://localhost:7777/oauth/callback',
    'http://[::1]:9/cb',
    'cursor://anysphere.cursor-mcp/oauth/callback',
  ]) assert.equal(redirectUriProblem(uri), null, uri);
});

test('redirectUriProblem refuses plain http, dangerous schemes, fragments, long and empty values', () => {
  for (const uri of [
    'http://example.org/cb',
    'javascript:alert(1)',
    'data:text/html,x',
    'file:///x',
    'https://a.example/cb#f',
    'https://a.example/cb#',
    `https://a.example/${'x'.repeat(512 - 'https://a.example/'.length + 1)}`,
    '',
    'vbscript:x', 'about:blank', 'blob:https://a.example/1', 'ws://a.example/', 'wss://a.example/', 'ftp://a.example/',
    'JAVASCRIPT:alert(1)',
    'https://a.example/cb\n',
    ' https://a.example/cb',
    'https://user@a.example/cb',
    'not a uri',
    'intent://x/#Intent;end', 'intent://x/', 'view-source:https://a.example/', 'chrome://settings', 'mailto:a@a.example', 'tel:+900000',
    'sms:+900000', 'filesystem:https://a.example/t', 'jar:https://a.example/x.jar!/', 'MAILTO:a@a.example',
    'http://127.0.0.1:5\\callback', 'https://a.example/<x>', 'https://a.example/"x"', 'https://a.example/{x}', 'https://a.example/a|b',
    'https://a.example/a^b', 'https://a.example/`x`',
  ]) assert.notEqual(redirectUriProblem(uri), null, JSON.stringify(uri));
  assert.equal(`https://a.example/${'x'.repeat(512 - 'https://a.example/'.length)}`.length, 512);
  assert.equal(redirectUriProblem(`https://a.example/${'x'.repeat(512 - 'https://a.example/'.length)}`), null, '512 is allowed');
});

test('redirectMatches is exact, except loopback http whose port is ignored', () => {
  assert.equal(redirectMatches(['http://127.0.0.1/callback'], 'http://127.0.0.1:51234/callback'), true);
  assert.equal(redirectMatches(['http://localhost/callback'], 'http://localhost:3118/callback'), true);
  assert.equal(redirectMatches(['http://[::1]:9/cb'], 'http://[::1]:4000/cb'), true);
  assert.equal(redirectMatches(['https://claude.ai/api/mcp/auth_callback'], 'https://claude.ai/api/mcp/auth_callback/'), false);
  assert.equal(redirectMatches(['https://claude.ai/api/mcp/auth_callback'], 'https://claude.ai/api/mcp/auth_callback'), true);
  assert.equal(redirectMatches(['http://127.0.0.1/callback'], 'http://127.0.0.1:5/other'), false);
  // Never across loopback names, never for https, never a fragment or a query added.
  assert.equal(redirectMatches(['http://localhost/callback'], 'http://127.0.0.1:5/callback'), false);
  assert.equal(redirectMatches(['https://a.example/cb'], 'https://a.example:444/cb'), false);
  assert.equal(redirectMatches(['https://A.example/cb'], 'https://a.example/cb'), false);
  assert.equal(redirectMatches(['http://127.0.0.1/callback'], 'http://127.0.0.1:5/callback#x'), false);
  assert.equal(redirectMatches(['http://127.0.0.1/callback'], 'http://127.0.0.1:5/callback?x=1'), false);
  assert.equal(redirectMatches(['http://127.0.0.1/callback'], 'http://evil@127.0.0.1:5/callback'), false);
  assert.equal(redirectMatches(['cursor://anysphere.cursor-mcp/oauth/callback'], 'cursor://anysphere.cursor-mcp:1/oauth/callback'), false);
  assert.equal(redirectMatches([], 'http://127.0.0.1/callback'), false);
});

test('isLoopbackOrCustom flags loopback and private-use schemes, not https', () => {
  assert.equal(isLoopbackOrCustom('http://127.0.0.1:33418'), true);
  assert.equal(isLoopbackOrCustom('http://localhost:7777/oauth/callback'), true);
  assert.equal(isLoopbackOrCustom('http://[::1]:9/cb'), true);
  assert.equal(isLoopbackOrCustom('cursor://anysphere.cursor-mcp/oauth/callback'), true);
  assert.equal(isLoopbackOrCustom('https://claude.ai/api/mcp/auth_callback'), false);
});

// --- CIMD (Call 10) ---------------------------------------------------------

const CIMD_ID = 'https://claude.example/oauth/client.json';
const doc = (over: Record<string, unknown> = {}) => ({
  client_id: CIMD_ID,
  client_name: 'Claude',
  redirect_uris: ['https://claude.example/api/mcp/auth_callback'],
  token_endpoint_auth_method: 'none',
  ...over,
});
const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' }, ...init });

test('a good CIMD document resolves to a client and writes nothing', async () => {
  const { db, DB } = setup();
  const before = changes(db);
  const http = stubHttp(['claude.example'], () => json(doc()));
  try {
    const client = await resolveClient(DB, CIMD_ID);
    assert.ok(!('error' in client));
    assert.deepEqual(client, {
      id: CIMD_ID, name: 'Claude', host: 'claude.example', redirectUris: ['https://claude.example/api/mcp/auth_callback'],
      kind: 'cimd', authMethod: 'none', secretHash: null,
    } satisfies Client);
    assert.equal(http.calls.length, 1);
    assert.equal(http.calls[0].url.href, CIMD_ID);
    assert.equal(http.calls[0].headers.get('Accept'), 'application/json');
  } finally { http.restore(); }
  assert.equal(changes(db), before, 'no D1 row written');
});

test('the CIMD fetch asks for no redirects and carries a timeout signal', async () => {
  const { DB } = setup();
  let seen: RequestInit | undefined;
  const client = await resolveClient(DB, CIMD_ID, (async (_url: RequestInfo | URL, init?: RequestInit) => {
    seen = init;
    return json(doc());
  }) as typeof fetch);
  assert.ok(!('error' in client));
  assert.equal(seen?.redirect, 'manual');
  assert.ok(seen?.signal instanceof AbortSignal);
  assert.equal(seen?.signal?.aborted, false);
});

test('a CIMD document that redirects, is too big, is not JSON, or does not match is bad_metadata', async () => {
  const { db, DB } = setup();
  const before = changes(db);
  const cases: [string, () => Response][] = [
    ['302', () => new Response(null, { status: 302, headers: { Location: 'https://claude.example/other.json' } })],
    ['404', () => json(doc(), { status: 404 })],
    ['17 KB', () => json({ ...doc(), padding: 'x'.repeat(17 * 1024) })],
    ['17 KB without a length', () => new Response(new ReadableStream({
      start(c) { for (let i = 0; i < 17; i++) c.enqueue(new Uint8Array(1024).fill(0x20)); c.close(); },
    }), { headers: { 'Content-Type': 'application/json' } })],
    ['text/html', () => new Response(JSON.stringify(doc()), { headers: { 'Content-Type': 'text/html' } })],
    ['no content type', () => new Response(new TextEncoder().encode(JSON.stringify(doc())))],
    ['not JSON', () => new Response('{ nope', { headers: { 'Content-Type': 'application/json' } })],
    ['client_id one character off', () => json(doc({ client_id: 'https://claude.example/oauth/client.jso' }))],
    ['client_id missing', () => json(doc({ client_id: undefined }))],
    ['redirect_uris empty', () => json(doc({ redirect_uris: [] }))],
    ['redirect_uris not a list', () => json(doc({ redirect_uris: 'https://claude.example/cb' }))],
    ['only refused redirect_uris', () => json(doc({ redirect_uris: ['http://example.org/cb', 'javascript:alert(1)'] }))],
    ['a secret-based auth method', () => json(doc({ token_endpoint_auth_method: 'private_key_jwt' }))],
    ['an array', () => json([doc()])],
  ];
  for (const [name, respond] of cases) {
    const http = stubHttp(['claude.example'], respond);
    try {
      assert.deepEqual(await resolveClient(DB, CIMD_ID), { error: 'bad_metadata' }, name);
      assert.equal(http.calls.length, 1, name);
    } finally { http.restore(); }
  }
  assert.equal(changes(db), before, 'nothing stored');
});

test('a CIMD fetch that times out is bad_metadata', async () => {
  const { DB } = setup();
  let signal: AbortSignal | null | undefined;
  const result = await resolveClient(DB, CIMD_ID, (async (_u: RequestInfo | URL, init?: RequestInit) => {
    signal = init?.signal;
    throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
  }) as typeof fetch);
  assert.deepEqual(result, { error: 'bad_metadata' });
  assert.ok(signal instanceof AbortSignal);
});

test('a CIMD body that stalls is cut off at the timeout', async () => {
  // Real time, but short: the timeout is injected. The body sends one byte
  // and then nothing, as a slow server would.
  const { DB } = setup();
  let cancelled = false;
  const started = Date.now();
  const http = stubHttp(['claude.example'], () => new Response(new ReadableStream({
    start(c) { c.enqueue(new TextEncoder().encode('{')); },
    cancel() { cancelled = true; },
  }), { headers: { 'Content-Type': 'application/json' } }));
  try {
    assert.deepEqual(await resolveClient(DB, CIMD_ID, undefined, { timeoutMs: 50 }), { error: 'bad_metadata' });
  } finally { http.restore(); }
  const took = Date.now() - started;
  assert.ok(took >= 40 && took < 2000, `took ${took} ms`);
  assert.equal(cancelled, true, 'the stream is cancelled');
});

test('a CIMD client_id that is not https with a path, is an IP or is our own host is refused without a fetch', async () => {
  const { db, DB } = setup();
  const before = changes(db);
  let calls = 0;
  const fetcher = (async () => { calls++; throw new Error('must not fetch'); }) as typeof fetch;
  for (const id of [
    'http://claude.example/x',
    'https://claude.example',
    'https://claude.example/',
    'https://192.0.2.1/x',
    'https://3221225985/x',
    'https://[2001:db8::1]/x',
    'https://rsg-turkiye.iscbsc.org/x',
    'https://RSG-Turkiye.iscbsc.org/x',
    'https://localhost/x',
    'https://rsg-turkiye.iscbsc.org./x',
    'https://RSG-Turkiye.iscbsc.org./x',
    'https://localhost./x',
    'https://a.localhost./x',
    'https://claude.example./x',
    'https://claude.example:6379/x',
    'https://claude.example:443/x',
    'https://user@claude.example/x',
    'https://claude.example/x#frag',
    `https://claude.example/${'x'.repeat(500)}`,
    'https://claude.example/x\n',
  ]) {
    const expected = id.startsWith('https://') ? 'bad_metadata' : 'unknown_client';
    assert.deepEqual(await resolveClient(DB, id, fetcher), { error: expected }, JSON.stringify(id));
  }
  assert.equal(calls, 0);
  // stubHttp too, as the brief has it: nothing reaches the stub.
  const http = stubHttp(['claude.example', '192.0.2.1', 'rsg-turkiye.iscbsc.org'], () => json(doc()));
  try {
    for (const id of [
      'http://claude.example/x', 'https://claude.example', 'https://192.0.2.1/x', 'https://rsg-turkiye.iscbsc.org/x',
      'https://rsg-turkiye.iscbsc.org./x', 'https://claude.example:6379/x',
    ]) {
      assert.ok('error' in await resolveClient(DB, id), id);
    }
    assert.equal(http.calls.length, 0);
  } finally { http.restore(); }
  assert.equal(changes(db), before);
});

test('a CIMD client name is cut to something showable, or the host', async () => {
  const { DB } = setup();
  for (const [name, expected] of [
    [undefined, 'claude.example'],
    ['', 'claude.example'],
    ['x'.repeat(101), 'claude.example'],
    ['Evil\u202eClaude', 'claude.example'],
    ['Cl\u200eaude', 'claude.example'],
    ['Claude\u200b', 'claude.example'],
    ['Cl\ufeffaude', 'claude.example'],
    ['Cl\u061caude', 'claude.example'],
    ['  Claude  ', 'Claude'],
  ] as const) {
    const http = stubHttp(['claude.example'], () => json(doc({ client_name: name })));
    try {
      const client = await resolveClient(DB, CIMD_ID);
      assert.ok(!('error' in client));
      assert.equal(client.name, expected, JSON.stringify(name));
    } finally { http.restore(); }
  }
});

// --- DCR (Call 8) -----------------------------------------------------------

test('parseRegistration defaults to client_secret_basic and ignores unknown fields', () => {
  const r = parseRegistration({
    client_name: 'Cursor', redirect_uris: ['cursor://anysphere.cursor-mcp/oauth/callback', 'http://127.0.0.1/callback'],
    grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], logo_uri: 'https://a.example/logo.png', jwks_uri: 'https://a.example/jwks',
  });
  assert.deepEqual(r, {
    ok: true, name: 'Cursor', redirectUris: ['cursor://anysphere.cursor-mcp/oauth/callback', 'http://127.0.0.1/callback'], authMethod: 'client_secret_basic',
  });
  const none = parseRegistration({ redirect_uris: ['http://127.0.0.1:33418'], token_endpoint_auth_method: 'none' });
  assert.ok(none.ok);
  assert.equal(none.authMethod, 'none');
  assert.equal(none.name, '127.0.0.1', 'no name: the redirect host');
});

test('parseRegistration refuses what it cannot serve', () => {
  const six = Array.from({ length: 6 }, (_, i) => `https://a.example/cb${i}`);
  const cases: [unknown, string][] = [
    [{ redirect_uris: ['https://a.example/cb'], grant_types: ['client_credentials'] }, 'invalid_client_metadata'],
    [{ redirect_uris: ['https://a.example/cb'], grant_types: ['authorization_code', 'implicit'] }, 'invalid_client_metadata'],
    [{ redirect_uris: ['https://a.example/cb'], grant_types: 'authorization_code' }, 'invalid_client_metadata'],
    [{ redirect_uris: ['https://a.example/cb'], response_types: ['token'] }, 'invalid_client_metadata'],
    [{ redirect_uris: ['https://a.example/cb'], token_endpoint_auth_method: 'private_key_jwt' }, 'invalid_client_metadata'],
    [{ redirect_uris: ['https://a.example/cb'], client_name: 'x'.repeat(101) }, 'invalid_client_metadata'],
    [{ redirect_uris: ['https://a.example/cb'], client_name: 'a\u0000b' }, 'invalid_client_metadata'],
    [{ redirect_uris: ['https://a.example/cb'], client_name: 'Cl\u200faude' }, 'invalid_client_metadata'],
    [{ redirect_uris: ['https://a.example/cb'], client_name: 'Claude\u200b' }, 'invalid_client_metadata'],
    [{ redirect_uris: ['https://a.example/cb'], grant_types: [] }, 'invalid_client_metadata'],
    [{ redirect_uris: ['https://a.example/cb'], client_name: 42 }, 'invalid_client_metadata'],
    [{ redirect_uris: six }, 'invalid_redirect_uri'],
    [{ redirect_uris: ['https://a.example/cb', 'http://example.org/cb'] }, 'invalid_redirect_uri'],
    [{ redirect_uris: [] }, 'invalid_redirect_uri'],
    [{ redirect_uris: [42] }, 'invalid_redirect_uri'],
    [{}, 'invalid_redirect_uri'],
    [null, 'invalid_client_metadata'],
    [[], 'invalid_client_metadata'],
    ['x', 'invalid_client_metadata'],
  ];
  for (const [body, error] of cases) {
    const r = parseRegistration(body);
    assert.equal(r.ok, false, JSON.stringify(body));
    if (!r.ok) {
      assert.equal(r.error, error, JSON.stringify(body));
      assert.ok(r.description.length > 0);
    }
  }
});

test('a registered client is stored with its secret hashed, and resolves by id', async () => {
  const { db, DB } = setup();
  const { statement, id, secret } = await registerStatement(DB, {
    name: 'Cursor', redirectUris: ['cursor://anysphere.cursor-mcp/oauth/callback'], authMethod: 'client_secret_basic', now: NOW,
  });
  assert.match(id, /^rsg_oc_[A-Za-z0-9_-]{43}$/);
  assert.match(secret, /^rsg_ocs_[A-Za-z0-9_-]{43}$/);
  await DB.batch([statement]);
  const row = db.prepare('SELECT * FROM oauth_clients').get() as Record<string, unknown>;
  assert.equal(row.secret_hash, await sha256Hex(secret));
  assert.ok(!JSON.stringify(row).includes(secret), 'the secret is not stored');
  assert.equal(row.created_at, NOW);

  const client = await resolveClient(DB, id);
  assert.deepEqual(client, {
    id, name: 'Cursor', host: 'cursor', redirectUris: ['cursor://anysphere.cursor-mcp/oauth/callback'],
    kind: 'dcr', authMethod: 'client_secret_basic', secretHash: await sha256Hex(secret),
  } satisfies Client);

  const loop = await registerStatement(DB, { name: 'VS Code', redirectUris: ['http://127.0.0.1:33418', 'https://vscode.example/redirect'], authMethod: 'none', now: NOW });
  await DB.batch([loop.statement]);
  const vs = await resolveClient(DB, loop.id);
  assert.ok(!('error' in vs));
  assert.equal(vs.host, '127.0.0.1');
});

test('an unknown client id is unknown_client', async () => {
  const { DB } = setup();
  assert.deepEqual(await resolveClient(DB, 'rsg_oc_' + 'A'.repeat(43)), { error: 'unknown_client' });
  assert.deepEqual(await resolveClient(DB, 'some-client'), { error: 'unknown_client' });
  assert.deepEqual(await resolveClient(DB, ''), { error: 'unknown_client' });
});

// --- client authentication ---------------------------------------------------

async function dcr(authMethod: Client['authMethod']): Promise<{ client: Client; secret: string }> {
  const secret = 'rsg_ocs_' + 'S'.repeat(43);
  return {
    secret,
    client: { id: 'rsg_oc_' + 'C'.repeat(43), name: 'x', host: 'x', redirectUris: ['https://a.example/cb'], kind: 'dcr', authMethod, secretHash: await sha256Hex(secret) },
  };
}

test('authenticateClient: a public DCR client needs no secret, a confidential one its own', async () => {
  const pub = await dcr('none');
  assert.equal(await authenticateClient(pub.client, { id: pub.client.id, secret: null, via: 'none' }), true);
  assert.equal(await authenticateClient(pub.client, { id: pub.client.id, secret: pub.secret, via: 'post' }), true, 'a presented secret is checked');
  assert.equal(await authenticateClient(pub.client, { id: pub.client.id, secret: 'rsg_ocs_wrong', via: 'post' }), false);

  const basic = await dcr('client_secret_basic');
  assert.equal(await authenticateClient(basic.client, { id: basic.client.id, secret: null, via: 'none' }), false);
  assert.equal(await authenticateClient(basic.client, { id: basic.client.id, secret: 'rsg_ocs_' + 'T'.repeat(43), via: 'basic' }), false);
  assert.equal(await authenticateClient(basic.client, { id: basic.client.id, secret: '', via: 'basic' }), false);
  assert.equal(await authenticateClient(basic.client, { id: basic.client.id, secret: basic.secret, via: 'basic' }), true);
  assert.equal(await authenticateClient(basic.client, { id: 'rsg_oc_' + 'D'.repeat(43), secret: basic.secret, via: 'basic' }), false, 'another id');
});

test('authenticateClient: a CIMD client never presents a secret', async () => {
  const client: Client = { id: CIMD_ID, name: 'Claude', host: 'claude.example', redirectUris: ['https://claude.example/cb'], kind: 'cimd', authMethod: 'none', secretHash: null };
  assert.equal(await authenticateClient(client, { id: CIMD_ID, secret: null, via: 'none' }), true);
  assert.equal(await authenticateClient(client, { id: CIMD_ID, secret: 'anything', via: 'basic' }), false);
  assert.equal(await authenticateClient(client, { id: CIMD_ID, secret: '', via: 'post' }), false);
});
