import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, globSync } from 'node:fs';
import { join } from 'node:path';

/**
 * No two webinars point at the same recording.
 *
 * Bernhard Renard's "Computational Metagenomics on the Species Level" carried
 * `youtubeUrl: http://www.youtube.com/watch?v=nfF_kZeZSJQ` -- the same video
 * Tolga Can's webinar linked, one entry above it in the listing. A reader who
 * opened Renard's talk got Can's. The copy was silent: both fields were
 * well-formed URLs, the schema is `z.string()`, and the page renders whatever
 * it is given.
 *
 * A shared recording is always a mistake here even when it looks deliberate:
 * two speakers, two talks, two videos. The one honest case -- no recording
 * exists -- is the empty string, which this ignores.
 *
 * Only the video id is compared, so the same talk linked once as `youtu.be/x`
 * and once as `watch?v=x` is still caught.
 */

const WEBINARS = new URL('../src/content/webinars/', import.meta.url).pathname;

/** The video a URL identifies, or the URL itself when it names no video. */
function videoId(url: string): string {
  const m = /(?:[?&]v=|youtu\.be\/|\/embed\/)([A-Za-z0-9_-]{6,})/.exec(url);
  return m ? m[1] : url;
}

function field(text: string, name: string): string {
  if (!text.startsWith('---')) return '';
  const end = text.indexOf('\n---', 3);
  const block = text.slice(3, end === -1 ? undefined : end);
  const m = new RegExp(`^${name}:\\s*(.*)$`, 'm').exec(block);
  return m ? m[1].trim().replace(/^["']|["']$/g, '') : '';
}

test('no two webinars in the same language share a recording', () => {
  const files = globSync('**/*.md', { cwd: WEBINARS });
  assert.ok(files.length >= 50, `expected the webinar collection, found ${files.length}`);

  // Per language: the English and Turkish pages of one talk are *meant* to
  // link the same video, so comparing across the two would report every
  // translated pair as a clash.
  const clashes: string[] = [];
  for (const lang of ['en', 'tr']) {
    const seen = new Map<string, string>();
    for (const file of files.filter((f) => f.startsWith(`${lang}/`))) {
      const url = field(readFileSync(join(WEBINARS, file), 'utf8'), 'youtubeUrl');
      if (!url) continue;
      const id = videoId(url);
      const first = seen.get(id);
      if (first) clashes.push(`${first} and ${file} both link ${id}`);
      else seen.set(id, file);
    }
  }

  assert.deepEqual(
    clashes,
    [],
    `Two webinars link the same recording, so one of them plays the wrong ` +
      `talk:\n    ${clashes.join('\n    ')}\n  `,
  );
});
