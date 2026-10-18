import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';

/**
 * Webinar pages load the YouTube player only when someone presses play.
 * Embedding it on load cost about a megabyte of script on every webinar page.
 * Reads dist/, so it needs a build, and skips itself without one.
 */
const DIST = new URL('../dist/', import.meta.url).pathname;
const built = existsSync(`${DIST}webinars`);

test('no webinar page embeds the player on load; each recording is a play link', { skip: !built && 'no build in dist/' }, () => {
  let facades = 0;
  for (const dir of [`${DIST}webinars`, `${DIST}tr/webinars`]) {
    for (const slug of readdirSync(dir)) {
      const file = `${dir}/${slug}/index.html`;
      if (!existsSync(file)) continue;
      const html = readFileSync(file, 'utf8');
      assert.doesNotMatch(html, /<iframe[^>]+youtube/i, `${file} still embeds the player`);
      const link = /<a href="https:\/\/www\.youtube\.com\/watch\?v=([\w-]+)"[^>]*class="yt-facade/.exec(html);
      if (/"@type":"VideoObject"/.test(html)) {
        assert.ok(link, `${file} has a recording but no play link`);
        assert.match(html, new RegExp(`i\\.ytimg\\.com/vi/${link![1]}/`), `${file}: thumbnail is for another video`);
        facades++;
      }
    }
  }
  assert.ok(facades > 40, `expected the recorded webinars, found ${facades}`);
});
