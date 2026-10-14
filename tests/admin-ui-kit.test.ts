import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from 'node-html-parser';
import { row, chip, switchControl, emptyState, BTN } from '../src/scripts/admin/ui-kit';

test('row escapes title and subtitle and keeps trailing HTML', () => {
  const html = row({ title: '<b>x</b>', subtitle: 'a & b', trailing: '<button>Ok</button>', attrs: 'data-id="1"' });
  const el = parse(html).firstChild as unknown as { getAttribute(n: string): string; innerHTML: string; text: string };
  assert.equal(el.getAttribute('data-id'), '1');
  assert.ok(!html.includes('<b>x</b>'));
  assert.ok(html.includes('&lt;b&gt;x&lt;/b&gt;'));
  assert.ok(html.includes('a &amp; b'));
  assert.ok(html.includes('<button>Ok</button>'));
});

test('switch is a real checkbox with a label, sized for a finger', () => {
  const html = switchControl({ id: 'r-admin', checked: true, label: 'Admin', hint: 'Her şey' });
  const root = parse(html);
  const input = root.querySelector('input#r-admin')!;
  assert.equal(input.getAttribute('type'), 'checkbox');
  assert.equal(input.getAttribute('role'), 'switch');
  assert.ok(input.hasAttribute('checked'));
  assert.ok(root.querySelector('label[for="r-admin"]'));
  assert.match(html, /min-h-11/);
});

test('chips and empty states escape their text; buttons meet the 44px target on phones', () => {
  assert.ok(chip('<x>').includes('&lt;x&gt;'));
  assert.ok(emptyState('<x>').includes('&lt;x&gt;'));
  for (const c of Object.values(BTN)) assert.match(c, /min-h-11/);
  assert.doesNotMatch(Object.values(BTN).join(' '), /text-gray-400/);
});
