import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  decodeBase64Url,
  decodeEncodedWords,
  pickHeader,
  parseFrom,
  htmlToText,
  extractPlainText,
  countAttachments,
  parseMessage,
  parseThread,
  threadIdsFromHistory,
} from '../functions/_lib/gmail-read';

const RSG = 'turkey.rsg@gmail.com';

function b64url(s: string): string {
  return Buffer.from(s, 'utf8').toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

test('decodeBase64Url restores UTF-8 text and tolerates missing padding', () => {
  assert.equal(decodeBase64Url(b64url('Merhaba dünya')), 'Merhaba dünya');
  assert.equal(decodeBase64Url(b64url('a')), 'a');
  assert.equal(decodeBase64Url(b64url('ab')), 'ab');
  assert.equal(decodeBase64Url(b64url('abc')), 'abc');
});

test('decodeBase64Url returns empty rather than throwing on malformed input', () => {
  assert.equal(decodeBase64Url('!!!not-base64!!!'), '');
  assert.equal(decodeBase64Url('abcde'), '');
  assert.equal(decodeBase64Url(''), '');
});

test('decodeEncodedWords decodes base64 and quoted-printable encoded-words', () => {
  const b = '=?UTF-8?B?' + Buffer.from('Emre Çevik', 'utf8').toString('base64') + '?=';
  assert.equal(decodeEncodedWords(b), 'Emre Çevik');
  assert.equal(decodeEncodedWords('=?UTF-8?Q?Emre_=C3=87evik?='), 'Emre Çevik');
});

test('decodeEncodedWords leaves plain text alone and survives a broken word', () => {
  assert.equal(decodeEncodedWords('Plain subject'), 'Plain subject');
  assert.equal(decodeEncodedWords('=?NOSUCHSET?B?zzz?='), '=?NOSUCHSET?B?zzz?=');
});

test('pickHeader matches case-insensitively and returns null when absent', () => {
  const headers = [{ name: 'Message-Id', value: '<a@x>' }];
  assert.equal(pickHeader(headers, 'Message-ID'), '<a@x>');
  assert.equal(pickHeader(headers, 'Subject'), null);
});

test('parseFrom splits a display name from an address and lowercases the address', () => {
  assert.deepEqual(parseFrom('"Emre Çevik" <Emre@Example.COM>'), {
    email: 'emre@example.com',
    name: 'Emre Çevik',
  });
  assert.deepEqual(parseFrom('bare@example.com'), { email: 'bare@example.com', name: null });
  assert.deepEqual(parseFrom(null), { email: '', name: null });
});

test('parseFrom survives trailing text after the address', () => {
  assert.deepEqual(parseFrom('"John Doe" <john@example.com> (via mailing list)'), {
    email: 'john@example.com',
    name: 'John Doe',
  });
});

test('parseFrom takes the first address when a relay header carries two', () => {
  // Deliberate: either choice is a guess, but the first is deterministic and
  // is always a valid address, where the old regex produced garbage.
  assert.deepEqual(parseFrom('"Relay" <relay@x.com> on behalf of "Real" <real@y.com>'), {
    email: 'relay@x.com',
    name: 'Relay',
  });
});

test('htmlToText drops scripts and tags, keeps line structure, unescapes once', () => {
  const text = htmlToText('<style>a{}</style><p>Hi<br>there</p><script>x()</script><p>&amp;lt; ok</p>');
  assert.ok(!text.includes('a{}'));
  assert.ok(!text.includes('x()'));
  assert.ok(!text.includes('<'), 'no markup may survive: ' + text);
  assert.ok(text.includes('Hi\nthere'));
  // &amp;lt; must become "&lt;", not "<" -- entities are unescaped exactly once.
  assert.ok(text.includes('&lt; ok'));
});

test('htmlToText keeps a literal less-than that is not a tag', () => {
  const text = htmlToText('<p>balance < 100 and quota > 50 before Friday</p>');
  assert.ok(text.includes('quota > 50'), 'got: ' + text);
  assert.ok(text.includes('before Friday'), 'got: ' + text);
});

test('extractPlainText prefers the text/plain part', () => {
  const payload = {
    mimeType: 'multipart/alternative',
    parts: [
      { mimeType: 'text/plain', body: { data: b64url('plain version') } },
      { mimeType: 'text/html', body: { data: b64url('<p>html version</p>') } },
    ],
  };
  assert.equal(extractPlainText(payload), 'plain version');
});

test('extractPlainText falls back to converting the HTML part', () => {
  const payload = {
    mimeType: 'multipart/alternative',
    parts: [{ mimeType: 'text/html', body: { data: b64url('<p>only html</p>') } }],
  };
  assert.equal(extractPlainText(payload), 'only html');
});

test('extractPlainText ignores a text/plain part that is an attachment', () => {
  const payload = {
    mimeType: 'multipart/mixed',
    parts: [
      { mimeType: 'text/plain', body: { data: b64url('real body') } },
      { mimeType: 'text/plain', filename: 'notes.txt', body: { data: b64url('attached notes') } },
    ],
  };
  assert.equal(extractPlainText(payload), 'real body');
});

test('extractPlainText returns an empty string when there is no text at all', () => {
  assert.equal(extractPlainText(undefined), '');
  assert.equal(extractPlainText({ mimeType: 'image/png', filename: 'a.png', body: {} }), '');
});

test('countAttachments counts named parts at any depth', () => {
  const payload = {
    mimeType: 'multipart/mixed',
    parts: [
      { mimeType: 'multipart/alternative', parts: [{ mimeType: 'text/plain', body: { data: b64url('x') } }] },
      { mimeType: 'application/pdf', filename: 'a.pdf', body: { attachmentId: 'z' } },
      { mimeType: 'multipart/related', parts: [{ mimeType: 'image/png', filename: 'b.png', body: {} }] },
    ],
  };
  assert.equal(countAttachments(payload), 2);
});

test('parseMessage marks a SENT-labelled message as outgoing', () => {
  const parsed = parseMessage({
    id: 'm1',
    threadId: 't1',
    labelIds: ['SENT'],
    internalDate: '1756000000000',
    payload: {
      mimeType: 'text/plain',
      headers: [
        { name: 'From', value: 'RSG Türkiye <turkey.rsg@gmail.com>' },
        { name: 'Subject', value: 'Davet' },
        { name: 'Message-ID', value: '<out1@mail.gmail.com>' },
      ],
      body: { data: b64url('Merhaba') },
    },
  }, RSG);

  assert.equal(parsed.direction, 'out');
  assert.equal(parsed.sentAt, 1756000000);
  assert.equal(parsed.rfc822MessageId, '<out1@mail.gmail.com>');
  assert.equal(parsed.bodyText, 'Merhaba');
  assert.equal(parsed.fromEmail, 'turkey.rsg@gmail.com');
});

test('parseMessage marks a message from anyone else as incoming', () => {
  const parsed = parseMessage({
    id: 'm2',
    threadId: 't1',
    labelIds: ['INBOX'],
    internalDate: '1756000100000',
    payload: {
      mimeType: 'text/plain',
      headers: [{ name: 'From', value: 'Prof <prof@uni.edu>' }],
      body: { data: b64url('Tesekkurler') },
    },
  }, RSG);

  assert.equal(parsed.direction, 'in');
  assert.equal(parsed.fromName, 'Prof');
});

test('parseMessage treats an unlabelled message from the RSG address as outgoing', () => {
  const parsed = parseMessage({
    id: 'm3',
    threadId: 't1',
    internalDate: '1756000200000',
    payload: { headers: [{ name: 'From', value: '<TURKEY.RSG@GMAIL.COM>' }] },
  }, RSG);

  assert.equal(parsed.direction, 'out');
});

test('parseMessage does not trust a forged From on a labelled inbound message', () => {
  const parsed = parseMessage({
    id: 'm4',
    threadId: 't1',
    labelIds: ['INBOX'],
    internalDate: '1756000300000',
    payload: { headers: [{ name: 'From', value: 'RSG <turkey.rsg@gmail.com>' }] },
  }, RSG);

  assert.equal(parsed.direction, 'in');
});

test('parseThread returns every message in ascending time order', () => {
  const messages = parseThread({
    id: 't1',
    messages: [
      { id: 'b', threadId: 't1', internalDate: '2000', payload: { headers: [{ name: 'From', value: 'x@y.z' }] } },
      { id: 'a', threadId: 't1', internalDate: '1000', payload: { headers: [{ name: 'From', value: 'x@y.z' }] } },
    ],
  }, RSG);

  assert.deepEqual(messages.map((m) => m.id), ['a', 'b']);
});

test('parseThread on an empty thread returns an empty array', () => {
  assert.deepEqual(parseThread({ id: 't1' }, RSG), []);
});

test('threadIdsFromHistory collects added messages and deduplicates', () => {
  const ids = threadIdsFromHistory({
    history: [
      { messagesAdded: [{ message: { id: 'm1', threadId: 't1' } }, { message: { id: 'm2', threadId: 't1' } }] },
      { messagesAdded: [{ message: { id: 'm3', threadId: 't2' } }] },
      { labelsAdded: [{ message: { id: 'm4', threadId: 't9' } }] },
    ],
  });

  // t9 changed labels only -- no new message, nothing to ingest.
  assert.deepEqual(ids.sort(), ['t1', 't2']);
});

test('threadIdsFromHistory on an empty history returns an empty array', () => {
  assert.deepEqual(threadIdsFromHistory({}), []);
  assert.deepEqual(threadIdsFromHistory({ history: [] }), []);
});

import { getProfileHistoryId, listHistory, fetchThread, GmailHistoryExpired } from '../functions/_lib/gmail-read';

function stubFetch(handler: (url: string) => Response): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string) => {
    if (String(url).includes('oauth2')) {
      return new Response(JSON.stringify({ access_token: 't', expires_in: 3600 }), { status: 200 });
    }
    return handler(String(url));
  }) as unknown as typeof fetch;
  return () => { globalThis.fetch = original; };
}

const READ_ENV = {
  GOOGLE_CLIENT_ID: 'cid',
  GOOGLE_CLIENT_SECRET: 'secret',
  GMAIL_REFRESH_TOKEN: 'refresh',
} as never;

test('getProfileHistoryId returns the cursor from the profile', async () => {
  const restore = stubFetch(() => new Response(JSON.stringify({ historyId: '4242' }), { status: 200 }));
  try {
    assert.equal(await getProfileHistoryId(READ_ENV), '4242');
  } finally {
    restore();
  }
});

test('listHistory returns thread ids and the new cursor', async () => {
  const restore = stubFetch(() => new Response(JSON.stringify({
    history: [{ messagesAdded: [{ message: { id: 'm1', threadId: 't1' } }] }],
    historyId: '5000',
  }), { status: 200 }));
  try {
    assert.deepEqual(await listHistory(READ_ENV, '4242'), { threadIds: ['t1'], historyId: '5000' });
  } finally {
    restore();
  }
});

test('listHistory follows pages and merges their thread ids', async () => {
  let call = 0;
  const restore = stubFetch(() => {
    call += 1;
    if (call === 1) {
      return new Response(JSON.stringify({
        history: [{ messagesAdded: [{ message: { threadId: 't1' } }] }],
        historyId: '5000',
        nextPageToken: 'p2',
      }), { status: 200 });
    }
    return new Response(JSON.stringify({
      history: [{ messagesAdded: [{ message: { threadId: 't2' } }] }],
      historyId: '5001',
    }), { status: 200 });
  });
  try {
    const result = await listHistory(READ_ENV, '4242');
    assert.deepEqual(result.threadIds.sort(), ['t1', 't2']);
    assert.equal(result.historyId, '5001');
  } finally {
    restore();
  }
});

test('listHistory throws GmailHistoryExpired on a 404', async () => {
  const restore = stubFetch(() => new Response('{"error":{"code":404}}', { status: 404 }));
  try {
    await assert.rejects(() => listHistory(READ_ENV, '1'), GmailHistoryExpired);
  } finally {
    restore();
  }
});

test('listHistory throws GmailHistoryExpired rather than paging forever', async () => {
  const restore = stubFetch(() => new Response(JSON.stringify({
    history: [{ messagesAdded: [{ message: { threadId: 't1' } }] }],
    historyId: '5000',
    nextPageToken: 'always-another',
  }), { status: 200 }));
  try {
    await assert.rejects(() => listHistory(READ_ENV, '1'), GmailHistoryExpired);
  } finally {
    restore();
  }
});

test('listHistory surfaces any other Gmail failure as an error', async () => {
  const restore = stubFetch(() => new Response('boom', { status: 500 }));
  try {
    await assert.rejects(() => listHistory(READ_ENV, '1'), /Gmail history failed \(500\)/);
  } finally {
    restore();
  }
});

test('fetchThread asks for the full format and returns the thread', async () => {
  let seen = '';
  const restore = stubFetch((url) => {
    seen = url;
    return new Response(JSON.stringify({ id: 't1', messages: [] }), { status: 200 });
  });
  try {
    const thread = await fetchThread(READ_ENV, 't1');
    assert.equal(thread.id, 't1');
    assert.ok(seen.includes('/threads/t1'));
    assert.ok(seen.includes('format=full'));
  } finally {
    restore();
  }
});

test('fetchThread rejects a thread id that is not a plain Gmail id', async () => {
  await assert.rejects(() => fetchThread(READ_ENV, '../messages/secret'), /invalid thread id/i);
});
