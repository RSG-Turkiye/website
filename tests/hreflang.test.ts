import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alternatesFor } from '../src/lib/hreflang';

test('a mirrored page is paired with its counterpart in the other language', () => {
  assert.deepEqual(alternatesFor('/about/'), { en: '/about/', tr: '/tr/about/' });
  assert.deepEqual(alternatesFor('/webinars/'), { en: '/webinars/', tr: '/tr/webinars/' });
  assert.deepEqual(alternatesFor('/blog/some-post/'), { en: '/blog/some-post/', tr: '/tr/blog/some-post/' });
});

test('the two copies of a page produce the same pair, so the tags are reciprocal', () => {
  // Google ignores hreflang that isn't claimed back from the other side.
  for (const [en, tr] of [['/about/', '/tr/about/'], ['/', '/tr/'], ['/tags/genomics/', '/tr/tags/genomics/']]) {
    assert.deepEqual(alternatesFor(en), alternatesFor(tr), en + ' and ' + tr + ' must agree');
  }
});

test('the home page pairs with the turkish home page', () => {
  assert.deepEqual(alternatesFor('/'), { en: '/', tr: '/tr/' });
  assert.deepEqual(alternatesFor('/tr/'), { en: '/', tr: '/tr/' });
  assert.deepEqual(alternatesFor('/tr'), { en: '/', tr: '/tr/' });
});

test('pages that exist in one language only get no pairing', () => {
  for (const path of ['/404', '/tags/', '/learning-paths/grad/', '/learning-paths/undergrad/']) {
    assert.equal(alternatesFor(path), null, path + ' has no counterpart');
  }
});

test('the sign-in-gated pages get no pairing either', () => {
  // They carry noindex, so annotating them would be pointless at best.
  for (const path of ['/login/', '/account/', '/admin/', '/members/', '/members/profile/', '/tr/admin/']) {
    assert.equal(alternatesFor(path), null, path + ' is noindex');
  }
});

test('paths are handled with or without a trailing slash', () => {
  assert.deepEqual(alternatesFor('/about'), alternatesFor('/about/'));
  assert.deepEqual(alternatesFor('/tr/about'), alternatesFor('/tr/about/'));
});

test('a path that merely starts with tr is not mistaken for the turkish prefix', () => {
  assert.deepEqual(alternatesFor('/translations/'), { en: '/translations/', tr: '/tr/translations/' });
});

// --- pages whose two slugs differ -------------------------------------------

test('an exact counterpart overrides the derived path', () => {
  // Six webinars have a Turkish slug that is not the English one. Deriving
  // the pair would advertise /tr/webinars/molecular-simulations/, which does
  // not exist -- worse than the missing tag it replaced, because it tells a
  // search engine a 404 is the translation.
  assert.deepEqual(
    alternatesFor('/webinars/molecular-simulations', '/tr/webinars/molekuler-simulasyonlar'),
    { en: '/webinars/molecular-simulations/', tr: '/tr/webinars/molekuler-simulasyonlar/' },
  );
});

test('the override works from the Turkish side too', () => {
  assert.deepEqual(
    alternatesFor('/tr/webinars/molekuler-simulasyonlar', '/webinars/molecular-simulations'),
    { en: '/webinars/molecular-simulations/', tr: '/tr/webinars/molekuler-simulasyonlar/' },
  );
});

test('the counterpart is given the trailing slash the canonical uses', () => {
  const pair = alternatesFor('/webinars/a', '/tr/webinars/b');
  assert.equal(pair?.tr, '/tr/webinars/b/');
  assert.equal(pair?.en, '/webinars/a/');
});

test('without a counterpart the derived pair is unchanged', () => {
  assert.deepEqual(alternatesFor('/about'), { en: '/about/', tr: '/tr/about/' });
  assert.deepEqual(alternatesFor('/tr/about'), { en: '/about/', tr: '/tr/about/' });
});

test('a noindex path stays unpaired even with a counterpart', () => {
  assert.equal(alternatesFor('/account', '/tr/account'), null);
});
