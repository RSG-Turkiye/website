import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onRequestPost } from '../functions/api/mail/dispatch';

/**
 * The order a queue row is handled in, asserted against a fake database.
 *
 * Everything else in this suite tests pure functions, and the two failures
 * that cost the most this week were not in one. They were in the order the
 * steps run: a row that killed the invocation while reading its attachment
 * reached no check that could retire it, and a claim that was a note rather
 * than a lock let two invocations send the same mail. Both are properties of
 * the sequence, so the sequence is what these record.
 */

const SECRET = 'test-secret';

interface Recorded {
  sql: string;
  values: unknown[];
}

/** Enough of D1 and R2 to run one tick, and a log of everything it did. */
function harness(options: {
  rows?: Record<string, unknown>[];
  claimChanges?: number;
  failResolveWith?: 'kill';
  /** Makes the post-send DELETE throw, which is what reaches the catch. */
  failDelete?: boolean;
}) {
  const log: Recorded[] = [];
  const rows = options.rows ?? [];

  const db = {
    prepare(sql: string) {
      const stmt = {
        bind(...values: unknown[]) {
          const record = () => log.push({ sql: sql.replace(/\s+/g, ' ').trim(), values });
          return {
            async all<T>() {
              record();
              if (/FROM scheduled_emails/.test(sql)) return { results: rows as T[] };
              if (/FROM mail_attachments/.test(sql)) {
                return {
                  results: [
                    {
                      id: 'att-1',
                      filename: 'dosya.pdf',
                      r2_key: 'k/att-1',
                      content_type: 'application/pdf',
                      size_bytes: 100,
                    },
                  ] as T[],
                };
              }
              return { results: [] as T[] };
            },
            async first<T>() {
              record();
              if (/is_sender/.test(sql)) return { is_sender: 1 } as T;
              if (/COUNT\(\*\)/.test(sql)) return { n: 0 } as T;
              return null;
            },
            async run() {
              record();
              if (options.failDelete && /DELETE FROM scheduled_emails/.test(sql)) {
                throw new Error('D1_ERROR: simulated delete failure');
              }
              return {
                meta: {
                  changes: /SET claimed_at/.test(sql) ? (options.claimChanges ?? 1) : 1,
                },
              };
            },
          };
        },
      };
      return stmt;
    },
    async batch(statements: unknown[]) {
      log.push({ sql: 'BATCH', values: [statements.length] });
      return [];
    },
  };

  const env = {
    MAIL_SYNC_SECRET: SECRET,
    RSG_MAIL_FROM: 'turkey.rsg@gmail.com',
    GOOGLE_CLIENT_ID: 'id',
    GOOGLE_CLIENT_SECRET: 'secret',
    GMAIL_REFRESH_TOKEN: 'refresh',
    DB: db,
    MAIL_ATTACHMENTS: {
      async head(key: string) {
        log.push({ sql: 'R2 head', values: [key] });
        if (options.failResolveWith === 'kill') throw new Error('isolate killed');
        return { size: 100 };
      },
      async get(key: string) {
        log.push({ sql: 'R2 get', values: [key] });
        // Closes immediately: a ReadableStream with no source never does, and
        // the encoder would wait on it for ever.
        return {
          body: new ReadableStream<Uint8Array>({
            start(c) {
              c.enqueue(new Uint8Array(100));
              c.close();
            },
          }),
        };
      },
    },
  };

  return { env, log, order: () => log.map((l) => l.sql) };
}

const queueRow = (over: Record<string, unknown> = {}) => ({
  id: 'row-1',
  sender_user_id: 'user-1',
  recipients: JSON.stringify(['a@x.org']),
  subject: 'Subject',
  body: 'Body',
  attachment_ids: JSON.stringify(['att-1']),
  first_tried_at: null,
  claimed_at: null,
  ...over,
});

/** Runs one tick at a fixed time inside the sending window. */
async function tick(env: unknown): Promise<Response> {
  const RealDate = globalThis.Date;
  // 2026-09-08 12:00 Istanbul, so the window is open whenever the suite runs.
  const fixed = RealDate.parse('2026-09-08T09:00:00Z');
  class Fixed extends RealDate {
    constructor(...args: unknown[]) {
      // @ts-expect-error -- forwarding a variadic Date constructor
      super(...(args.length === 0 ? [fixed] : args));
    }
    static now() {
      return fixed;
    }
  }
  globalThis.Date = Fixed as DateConstructor;
  const fetchBefore = globalThis.fetch;
  globalThis.fetch = (async (_url: unknown, init?: { body?: unknown }) => {
    // Gmail reads the upload as it is produced; a stub that ignores the body
    // would leave the encoder blocked on backpressure for ever.
    const body = init?.body;
    if (body instanceof ReadableStream) {
      const reader = body.getReader();
      for (;;) {
        const { done } = await reader.read();
        if (done) break;
      }
    }
    return new Response(JSON.stringify({ access_token: 't', id: 'm1', threadId: 't1' }), {
      status: 200,
    });
  }) as unknown as typeof fetch;

  // FixedLengthStream is a Workers global. Only the runtime enforces the
  // declared length; the arithmetic behind that number is tested against the
  // real encoder in mime-stream.test.ts.
  const streamBefore = (globalThis as Record<string, unknown>).FixedLengthStream;
  (globalThis as Record<string, unknown>).FixedLengthStream = class {
    readable: ReadableStream;
    writable: WritableStream;
    constructor(_length: number) {
      const { readable, writable } = new TransformStream();
      this.readable = readable;
      this.writable = writable;
    }
  };
  try {
    return await (onRequestPost as (c: unknown) => Promise<Response>)({
      request: new Request('https://x/api/mail/dispatch', {
        method: 'POST',
        headers: { 'X-Dispatch-Secret': SECRET },
      }),
      env,
    });
  } finally {
    globalThis.Date = RealDate;
    globalThis.fetch = fetchBefore;
    (globalThis as Record<string, unknown>).FixedLengthStream = streamBefore;
  }
}

const indexOf = (order: string[], pattern: RegExp) => order.findIndex((s) => pattern.test(s));

// --- the attempt is recorded before the step that can kill the tick ---------

test('the attempt is stamped before the attachment is touched', async () => {
  // The row that stalled the queue for six and a half hours died while reading
  // its attachment, so it never reached the claim -- and while the attempt was
  // stamped at the claim, its clock never started and nothing could retire it.
  const h = harness({ rows: [queueRow()] });
  await tick(h.env);
  const order = h.order();

  const stamp = indexOf(order, /SET attempts = attempts \+ 1/);
  const attachment = indexOf(order, /^R2 head$/);
  assert.notEqual(stamp, -1, 'the attempt is stamped');
  assert.notEqual(attachment, -1, 'the attachment is read');
  assert.ok(stamp < attachment, `stamp (${stamp}) must precede the attachment read (${attachment})`);
});

test('a tick killed while reading the attachment still leaves the clock started', async () => {
  const h = harness({ rows: [queueRow()], failResolveWith: 'kill' });
  await tick(h.env).catch(() => undefined); // the kill is simulated as a throw
  const order = h.order();
  assert.ok(indexOf(order, /SET attempts = attempts \+ 1/) !== -1, 'the attempt survives the kill');
});

test('the attempt is counted once, not once per branch', async () => {
  const h = harness({ rows: [queueRow()] });
  await tick(h.env);
  const stamps = h.order().filter((s) => /attempts = attempts \+ 1/.test(s));
  assert.equal(stamps.length, 1);
});

// --- the claim is a lock ----------------------------------------------------

test('the claim is conditional on nobody else holding the row', async () => {
  const h = harness({ rows: [queueRow()] });
  await tick(h.env);
  const claim = h.log.find((l) => /SET claimed_at/.test(l.sql));
  assert.ok(claim, 'the row is claimed');
  assert.match(claim.sql, /WHERE id = \? AND \(claimed_at IS NULL OR claimed_at <= \?\)/);
});

test('losing the claim race sends nothing', async () => {
  // Two invocations both selected the row; this one lost. It must leave the
  // row to the winner rather than send the same mail a second time.
  const h = harness({ rows: [queueRow()], claimChanges: 0 });
  const res = await tick(h.env);
  const body = await res.json<{ sent: number }>();

  assert.equal(body.sent, 0);
  assert.equal(indexOf(h.order(), /^R2 get$/), -1, 'the attachment is never streamed');
  assert.equal(indexOf(h.order(), /DELETE FROM scheduled_emails/), -1, 'the row is left alone');
});

test('winning the claim proceeds to the send', async () => {
  const h = harness({ rows: [queueRow()], claimChanges: 1 });
  const res = await tick(h.env);
  const body = await res.json<{ sent: number }>();
  assert.equal(body.sent, 1);
  assert.notEqual(indexOf(h.order(), /^R2 get$/), -1, 'the attachment is streamed');
});

// --- the window still wins --------------------------------------------------

test('nothing is stamped, claimed or read outside the sending window', async () => {
  const h = harness({ rows: [queueRow()] });
  const RealDate = globalThis.Date;
  const night = RealDate.parse('2026-09-08T01:00:00Z'); // 04:00 Istanbul
  class Night extends RealDate {
    constructor(...args: unknown[]) {
      // @ts-expect-error -- forwarding a variadic Date constructor
      super(...(args.length === 0 ? [night] : args));
    }
    static now() {
      return night;
    }
  }
  globalThis.Date = Night as DateConstructor;
  try {
    const res = await (onRequestPost as (c: unknown) => Promise<Response>)({
      request: new Request('https://x/api/mail/dispatch', {
        method: 'POST',
        headers: { 'X-Dispatch-Secret': SECRET },
      }),
      env: h.env,
    });
    const body = await res.json<{ held?: string }>();
    assert.match(body.held ?? '', /outside 8:00-22:00/);
  } finally {
    globalThis.Date = RealDate;
  }
  assert.equal(indexOf(h.order(), /attempts = attempts \+ 1/), -1);
  assert.equal(indexOf(h.order(), /^R2 head$/), -1);
});

test('a handled error records the reason without counting a second attempt', async () => {
  // The catch branch used to stamp attempts and first_tried_at again, on top
  // of the stamp taken before the work began. A row hitting a transient
  // failure therefore burned two attempts a tick and retired in half the six
  // hours it is promised. The rate-limit branch had the same bug and lost it
  // when the stamp moved; this one kept it, and the existing "counted once"
  // test did not catch it because it only drives the happy path.
  const h = harness({ rows: [queueRow()], failDelete: true });
  await tick(h.env).catch(() => undefined);

  const stamps = h.order().filter((s) => /attempts = attempts \+ 1/.test(s));
  assert.equal(stamps.length, 1, 'exactly one attempt per tick, whatever happens after');

  const reason = h.log.find((l) => /SET last_error/.test(l.sql));
  assert.ok(reason, 'and the reason is still recorded');
  assert.ok(!/attempts/.test(reason.sql), 'the reason update touches no counter');
});
