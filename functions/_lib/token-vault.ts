/**
 * Platform tokens at rest. AES-GCM with a 256-bit key from the TOKEN_ENC_KEY
 * Pages secret (generate with `openssl rand -base64 32`), a fresh 96-bit IV
 * per seal, and the row's purpose ("gmail:refresh") as additional
 * authenticated data -- so a ciphertext copied into another row's column
 * fails to open rather than becoming that platform's token.
 *
 * Every failure is a VaultError. Callers treat it as "this connection is
 * broken, reconnect", never as a reason to stop serving.
 */
export class VaultError extends Error {}

const enc = new TextEncoder();
const dec = new TextDecoder();

function toB64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function fromB64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function importKey(keyB64: string | undefined): Promise<CryptoKey> {
  if (!keyB64) throw new VaultError('TOKEN_ENC_KEY is not set');
  let raw: Uint8Array;
  try {
    raw = fromB64(keyB64);
  } catch {
    throw new VaultError('TOKEN_ENC_KEY is not valid base64');
  }
  if (raw.length !== 32) throw new VaultError('TOKEN_ENC_KEY must be 32 bytes, base64-encoded');
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function seal(keyB64: string | undefined, plaintext: string, context: string): Promise<string> {
  const key = await importKey(keyB64);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(context) }, key, enc.encode(plaintext));
  return `v1.${toB64(iv)}.${toB64(new Uint8Array(ct))}`;
}

export async function unseal(keyB64: string | undefined, sealed: string, context: string): Promise<string> {
  const key = await importKey(keyB64);
  const parts = sealed.split('.');
  if (parts.length !== 3 || parts[0] !== 'v1') throw new VaultError('Not a sealed token');
  try {
    const pt = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromB64(parts[1]), additionalData: enc.encode(context) },
      key,
      fromB64(parts[2]),
    );
    return dec.decode(pt);
  } catch {
    throw new VaultError('Sealed token could not be opened (wrong key, wrong row, or altered)');
  }
}
