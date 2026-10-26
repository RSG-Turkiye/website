import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from 'node-html-parser';
import { ui } from '../src/i18n/ui';
import { usageHtml, type HealthUsage, type HealthDeps } from '../src/scripts/admin-health';

const NOW = Date.parse('2026-10-26T12:00:00Z') / 1000;

function deps(lang: 'en' | 'tr'): HealthDeps {
  const t = (k: string) => (ui[lang] as Record<string, string>)[k] ?? k;
  return { t, tf: (k, vars) => Object.entries(vars).reduce((s, [n, v]) => s.split(`{${n}}`).join(String(v)), t(k)), lang };
}
const d = deps('en');

function usage(over: Partial<HealthUsage> = {}): HealthUsage {
  return {
    configured: true, checkedAt: NOW - 600, measuredAt: NOW - 600, day: '2026-10-26',
    requests: 42_000, rowsRead: 1_000_000, rowsWritten: 20_000, failed: false, error: null,
    agentRequests: 12, agentWrites: 4,
    limits: { requests: 100_000, rowsRead: 5_000_000, rowsWritten: 100_000, agentRequests: 15_000, agentWrites: 2_000 },
    ...over,
  };
}
const text = (html: string) => parse(html).text.replace(/\s+/g, ' ');

test('numbers show as value of limit with a percent', () => {
  const s = text(usageHtml(usage(), d, NOW));
  assert.match(s, /Free plan, today \(UTC\)/);
  assert.match(s, /Worker requests: 42,000 of 100,000 \(42%\)/);
  assert.match(s, /D1 rows read: 1,000,000 of 5,000,000 \(20%\)/);
  assert.match(s, /D1 rows written: 20,000 of 100,000 \(20%\)/);
  assert.match(s, /Agent requests: 12 of 15,000 \(0%\)/);
  assert.match(s, /Agent writes: 4 of 2,000 \(0%\)/);
  assert.match(s, /Measured at .+\. Admins get an e-mail at 70% and 90%\./);
});

test('the lines come in a fixed order', () => {
  const s = text(usageHtml(usage(), d, NOW));
  const at = ['Worker requests', 'D1 rows read', 'D1 rows written', 'Agent requests', 'Agent writes'].map((l) => s.indexOf(l));
  assert.deepEqual([...at].sort((a, b) => a - b), at);
  assert.ok(at[0] >= 0);
});

test('a line at or past 70% is bold, and only that one', () => {
  const root = parse(usageHtml(usage({ rowsWritten: 70_000 }), d, NOW));
  const bold = root.querySelectorAll('.font-semibold').map((e) => e.text);
  assert.equal(bold.filter((b) => /D1 rows written/.test(b)).length, 1);
  assert.equal(bold.filter((b) => /Worker requests|D1 rows read|Agent/.test(b)).length, 0);
});

test('Turkish numbers and percent are written the Turkish way', () => {
  const s = text(usageHtml(usage(), deps('tr'), NOW));
  assert.match(s, /Worker istekleri: 100\.000 içinde 42\.000 \(%42\)/);
});

test('not configured says so and still shows the agent lines', () => {
  const s = text(usageHtml(usage({ configured: false, requests: null, rowsRead: null, rowsWritten: null, day: null, checkedAt: null, measuredAt: null }), d, NOW));
  assert.match(s, /CF_ANALYTICS_TOKEN is not set/);
  assert.match(s, /Agent writes/);
  assert.doesNotMatch(s, /Worker requests/);
});

test('a failed check says so with the error for admins', () => {
  const s = text(usageHtml(usage({ failed: true, error: 'not authorized', checkedAt: NOW - 60 }), d, NOW));
  assert.match(s, /The check at .+ failed: not authorized/);
});

test('a failed check without the reason says an admin can see it', () => {
  const s = text(usageHtml(usage({ failed: true, error: null }), d, NOW));
  assert.match(s, /failed\. An admin can see why\./);
});

test('the error text is escaped', () => {
  const html = usageHtml(usage({ failed: true, error: '<img src=x onerror=alert(1)>' }), d, NOW);
  assert.ok(!html.includes('<img'));
});

test('a check that never worked says it failed, not that it has not run', () => {
  // A wrong GraphQL field name: every hour fails, day stays empty.
  const s = text(usageHtml(usage({ failed: true, error: 'Cannot query field', day: null, measuredAt: null, requests: null, rowsRead: null, rowsWritten: null }), d, NOW));
  assert.match(s, /failed: Cannot query field/);
  assert.doesNotMatch(s, /Not measured yet today/);
  assert.doesNotMatch(s, /Worker requests/);
});

test('stale check is said', () => {
  const s = text(usageHtml(usage({ checkedAt: NOW - 4 * 3600, measuredAt: NOW - 4 * 3600 }), d, NOW));
  assert.match(s, /Not checked since/);
});

test('one missed hour is not yet stale', () => {
  const s = text(usageHtml(usage({ checkedAt: NOW - 2 * 3600 }), d, NOW));
  assert.doesNotMatch(s, /Not checked since/);
  assert.match(s, /Measured at/);
});

test('yesterday\'s numbers are not shown as today\'s', () => {
  const s = text(usageHtml(usage({ day: '2026-10-25' }), d, NOW));
  assert.match(s, /Not measured yet today/);
  assert.doesNotMatch(s, /Worker requests/);
  assert.match(s, /Agent requests/);
});

test('null usage renders nothing', () => assert.equal(usageHtml(null, d, NOW), ''));
