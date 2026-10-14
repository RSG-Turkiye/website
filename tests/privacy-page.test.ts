import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { PRIVACY } from '../src/data/privacy';
import { RETENTION_SECONDS } from '../functions/_lib/certificates';
import { AUDIT_RETENTION_SECONDS } from '../functions/_lib/audit';

/**
 * The privacy notice is a promise about what the code does. LinkedIn's API
 * review and anyone asking under KVKK read it, so a retention number that
 * drifts from the job enforcing it is a false statement, not a typo.
 */

const REPO = new URL('../', import.meta.url).pathname;
const DAY = 86400;

test('the notice exists in both languages, at mirrored paths', () => {
  assert.ok(existsSync(`${REPO}src/pages/privacy.astro`));
  assert.ok(existsSync(`${REPO}src/pages/tr/privacy.astro`));
});

test('both languages say the same things, section for section', () => {
  const { en, tr } = PRIVACY;
  assert.equal(en.intro.length, tr.intro.length);
  assert.equal(en.sections.length, tr.sections.length);
  en.sections.forEach((s, i) => {
    const other = tr.sections[i];
    assert.equal(s.items?.length, other.items?.length, `items in "${s.heading}"`);
    assert.equal(s.paragraphs?.length, other.paragraphs?.length, `paragraphs in "${s.heading}"`);
  });
});

test('the retention lines match the jobs that enforce them', () => {
  assert.equal(RETENTION_SECONDS, 30 * DAY, 'certificates: the notice says 30 days');
  assert.equal(AUDIT_RETENTION_SECONDS, 365 * DAY, 'audit log: the notice says 1 year');
  const auth = readFileSync(`${REPO}functions/_lib/auth.ts`, 'utf8');
  assert.match(auth, /SESSION_DURATION = 60 \* 60 \* 24 \* 30;/, 'sessions: the notice says 30 days');
  assert.match(auth, /const SESSION_COOKIE = 'rsg_session';/, 'the notice names the cookie');
  const purge = readFileSync(`${REPO}functions/api/admin/certificates/purge.ts`, 'utf8');
  assert.match(purge, /now - 86400/, 'certificate lookups: the notice says 1 day');
});

test('the footer links to the notice', () => {
  const footer = readFileSync(`${REPO}src/components/Footer.astro`, 'utf8');
  assert.match(footer, /\$\{prefix\}\/privacy\//);
});

test('the notice says how DMs are handled, in both languages', () => {
  const en = JSON.stringify(PRIVACY.en);
  const tr = JSON.stringify(PRIVACY.tr);
  assert.match(en, /direct messages/i);
  assert.match(en, /account ID/);
  assert.match(tr, /hesap kimliğini/);
  assert.ok(!en.includes('We do not read or store data about other people from these platforms'), 'old sentence removed');
  assert.ok(!tr.includes('Bu platformlardan başka kişilere ait veri okumayız'), 'old tr sentence removed');
});
