/** An in-memory stand-in for the parts of R2Bucket the handlers use. */
export function fakeR2() {
  const store = new Map<string, { body: Uint8Array; contentType?: string }>();
  return {
    store,
    async put(key: string, value: ArrayBuffer | Uint8Array, opts?: { httpMetadata?: { contentType?: string } }) {
      store.set(key, { body: new Uint8Array(value as ArrayBuffer), contentType: opts?.httpMetadata?.contentType });
    },
    /** Honours `range: Headers` the way R2 does for a single `bytes=a-b`. */
    async get(key: string, opts?: { range?: Headers }) {
      const o = store.get(key);
      if (!o) return null;
      const m = opts?.range?.get('Range')?.match(/^bytes=(\d+)-(\d*)$/);
      const range = m
        ? { offset: Number(m[1]), length: (m[2] ? Math.min(Number(m[2]), o.body.length - 1) : o.body.length - 1) - Number(m[1]) + 1 }
        : undefined;
      const bytes = range ? o.body.slice(range.offset, range.offset + range.length) : o.body;
      return {
        body: new Blob([bytes]).stream(),
        size: o.body.length,
        range,
        httpEtag: '"etag"',
        writeHttpMetadata(h: Headers) { if (o.contentType) h.set('Content-Type', o.contentType); },
      };
    },
    /** Keys in order, with a prefix: enough of R2's list() for the handlers. */
    async list(opts?: { prefix?: string; limit?: number }) {
      const keys = [...store.keys()].filter((k) => !opts?.prefix || k.startsWith(opts.prefix)).sort();
      return { objects: keys.slice(0, opts?.limit ?? 1000).map((key) => ({ key, size: store.get(key)!.body.length })), truncated: false };
    },
    async head(key: string) {
      const o = store.get(key);
      return o ? { key, size: o.body.length, httpEtag: '"etag"' } : null;
    },
    async delete(keys: string | string[]) {
      for (const k of Array.isArray(keys) ? keys : [keys]) store.delete(k);
    },
  };
}
