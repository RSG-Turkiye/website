import { test } from 'node:test';
import assert from 'node:assert/strict';
import { yearAblative } from '../src/lib/turkish-year';

test('a year takes the ablative its spoken form calls for', () => {
  assert.equal(yearAblative(2019), "2019'dan"); // dokuz
  assert.equal(yearAblative(2012), "2012'den"); // iki
  assert.equal(yearAblative(2011), "2011'den"); // bir
  assert.equal(yearAblative(2013), "2013'ten"); // üç
  assert.equal(yearAblative(2016), "2016'dan"); // altı
  assert.equal(yearAblative(2020), "2020'den"); // yirmi
  assert.equal(yearAblative(2030), "2030'dan"); // otuz
  assert.equal(yearAblative(2040), "2040'tan"); // kırk
  assert.equal(yearAblative(2000), "2000'den"); // bin
});
