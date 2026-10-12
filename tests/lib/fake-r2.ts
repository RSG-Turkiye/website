/** An in-memory stand-in for the parts of R2Bucket the handlers use. */
export function fakeR2() {
  const store = new Map<string, { body: Uint8Array; contentType?: string }>();
  return {
    store,
    async put(key: string, value: ArrayBuffer | Uint8Array, opts?: { httpMetadata?: { contentType?: string } }) {
      store.set(key, { body: new Uint8Array(value as ArrayBuffer), contentType: opts?.httpMetadata?.contentType });
    },
    async get(key: string) {
      const o = store.get(key);
      if (!o) return null;
      return {
        body: new Blob([o.body]).stream(),
        size: o.body.length,
        httpEtag: '"etag"',
        writeHttpMetadata(h: Headers) { if (o.contentType) h.set('Content-Type', o.contentType); },
      };
    },
    async delete(keys: string | string[]) {
      for (const k of Array.isArray(keys) ? keys : [keys]) store.delete(k);
    },
  };
}
