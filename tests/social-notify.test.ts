import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setupSocial, stubMail } from './lib/social';
import { sendSystemEmail, notificationText, publisherEmails, notifyEach, postLabel } from '../functions/_lib/social-notify';

test('publishers are admins and social publishers, nobody else', async () => {
  const { env } = setupSocial();
  assert.deepEqual((await publisherEmails((env as { DB: D1Database }).DB)).sort(), ['admin@example.org', 'pub@example.org']);
});

test('a system email goes out from the RSG address', async () => {
  const { env } = setupSocial();
  const mail = stubMail();
  try {
    assert.equal(await sendSystemEmail(env, { to: 'ed@example.org', subject: 'Deneme', text: 'Merhaba' }), true);
    assert.deepEqual(mail.sent, [{ to: 'ed@example.org', subject: 'Deneme' }]);
  } finally { mail.restore(); }
});

test('a failing Gmail is reported as false, never thrown', async () => {
  const { env } = setupSocial();
  const mail = stubMail();
  mail.fail();
  try {
    assert.equal(await sendSystemEmail(env, { to: 'ed@example.org', subject: 'x', text: 'y' }), false);
  } finally { mail.restore(); }
});

test('notifyEach skips duplicates and blanks and counts what went', async () => {
  const { env } = setupSocial();
  const mail = stubMail();
  try {
    assert.equal(await notifyEach(env, ['a@example.org', 'a@example.org', '', 'b@example.org'], { subject: 's', text: 't' }), 2);
    assert.equal(mail.sent.length, 2);
  } finally { mail.restore(); }
});

test('every kind of message is bilingual and names the post', () => {
  for (const kind of ['submitted', 'approved', 'rejected', 'plan_due'] as const) {
    const m = notificationText(kind, { label: 'Konuşmacı 3', when: 1_800_000_000, actor: 'Ayşe', note: 'Görseli değiştir', panelUrl: 'https://rsg-turkiye.iscbsc.org/admin' });
    assert.match(m.subject, /Konuşmacı 3/, kind);
    assert.match(m.text, /https:\/\/rsg-turkiye\.iscbsc\.org\/admin/, kind);
    assert.match(m.text, /\n---\n/, `${kind} has a Turkish and an English half`);
  }
  assert.match(notificationText('rejected', { label: 'x', when: null, note: 'Görseli değiştir', panelUrl: 'u' }).text, /Görseli değiştir/);
});

test('a long Turkish subject survives the Subject round trip whole', async () => {
  const { env } = setupSocial();
  const mail = stubMail();
  const subject = notificationText('submitted', { label: 'Konuşmacı 3 ve çok uzun bir başlık ğüşiöç', when: null, panelUrl: 'u' }).subject;
  try {
    assert.equal(await sendSystemEmail(env, { to: 'ed@example.org', subject, text: 'x' }), true);
    assert.equal(mail.sent[0].subject, subject);
  } finally { mail.restore(); }
});

test('postLabel prefers the plan title, then the caption start', () => {
  assert.equal(postLabel('uzun bir metin', 'Plan adı'), 'Plan adı');
  assert.equal(postLabel('a'.repeat(80), null), `${'a'.repeat(60)}…`);
  assert.equal(postLabel('  ', null), '(başlıksız / untitled)');
});

// Labels are written by people and by agent tokens; mail goes out from the
// organisation's own address, so nothing in a label may become a link.
test('a label, note or actor is inert text in the mail: no Markdown link, no bare URL, no markup', () => {
  const panelUrl = 'https://rsg-turkiye.iscbsc.org/admin';
  for (const label of ['[Reset your password](https://evil.example/rsg)', 'see https://evil.example/x now', 'evil.example', 'www.evil.example', '<b>x</b> **bold**']) {
    for (const kind of ['submitted', 'approved', 'rejected', 'plan_due', 'publish_failed'] as const) {
      const m = notificationText(kind, { label, when: null, actor: 'https://evil.example/a', note: '[n](https://evil.example/n)', panelUrl });
      const anchors = [...m.body.html.matchAll(/<a href="([^"]*)"/g)].map((x) => x[1]);
      assert.deepEqual([...new Set(anchors)], [panelUrl], `${kind}: only the panel link is a link (${label})`);
      for (const part of [m.body.html, m.text]) {
        assert.doesNotMatch(part, /https:\/\/evil|evil\.example|www\.evil/, `${kind}: no URL or domain survives as written`);
      }
      assert.doesNotMatch(m.body.html, /<b>|<strong>x|<strong>bold/, 'markup in a label is escaped, Markdown is not applied');
      assert.match(m.body.html, /&lt;b&gt;|Reset your password|see https|evil/, 'the label is still there to read');
    }
  }
});

test('the subject carries the label on one line, without control characters, at most 80 characters', () => {
  const m = notificationText('plan_due', { label: `Plan\r\nBcc: x@example.org\u0007 ${'ğ'.repeat(200)}`, when: null, panelUrl: 'u' });
  const label = m.subject.split(': ').slice(1).join(': ');
  assert.doesNotMatch(m.subject, /[\r\n\u0007]/);
  assert.ok([...label].length <= 80, `label part has ${[...label].length} characters`);
  assert.ok(label.endsWith('…'));
});
