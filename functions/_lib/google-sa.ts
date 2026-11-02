/**
 * An access token for a Google service account, from its JSON key (the
 * GOOGLE_SA_KEY secret, set by a maintainer: CLAUDE.md rule 7). The JWT is
 * signed with WebCrypto (RS256), which Workers have; no Google library.
 *
 * Tokens are cached in memory until a minute before they expire, per scope
 * set. A Pages Function's memory lives only as long as its isolate, so a
 * cold start fetches a new one: that is one subrequest, which is fine.
 */

interface ServiceAccountKey { client_email: string; private_key: string; token_uri?: string }

const cache = new Map<string, { token: string; expiresAt: number }>();
export const clearGoogleTokenCache = () => cache.clear();

const b64url = (bytes: ArrayBuffer | Uint8Array) => {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (const b of u8) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const b64urlJson = (v: unknown) => b64url(new TextEncoder().encode(JSON.stringify(v)));

function pemToPkcs8(pem: string): ArrayBuffer {
  const body = pem.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, '').replace(/\s+/g, '');
  const bin = atob(body);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

export async function getGoogleToken(keyJson: string, scopes: string[], now = Math.floor(Date.now() / 1000)): Promise<string> {
  const key = JSON.parse(keyJson) as ServiceAccountKey;
  if (!key.client_email || !key.private_key) throw new Error('google_sa: the key has no client_email or private_key');
  const scope = scopes.join(' ');
  const cacheKey = `${key.client_email} ${scope}`;
  const hit = cache.get(cacheKey);
  if (hit && hit.expiresAt - 60 > now) return hit.token;

  const aud = key.token_uri ?? 'https://oauth2.googleapis.com/token';
  const unsigned = `${b64urlJson({ alg: 'RS256', typ: 'JWT' })}.${b64urlJson({ iss: key.client_email, scope, aud, iat: now, exp: now + 3600 })}`;
  const signingKey = await crypto.subtle.importKey('pkcs8', pemToPkcs8(key.private_key), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', signingKey, new TextEncoder().encode(unsigned));
  const res = await fetch(aud, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${b64url(signature)}` }).toString(),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`google_sa: token request failed (${res.status})`);
  const body = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!body.access_token) throw new Error('google_sa: no access_token');
  cache.set(cacheKey, { token: body.access_token, expiresAt: now + Number(body.expires_in ?? 3600) });
  return body.access_token;
}
