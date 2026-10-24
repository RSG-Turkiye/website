/**
 * Pull the podcast feed into src/data/podcast.json.
 *
 * The normal way is the admin panel: İçerik › Podcast › "Yeni bölümleri
 * çek" makes a draft that is approved like any other change. This script
 * is the fallback, run by hand: `npm run podcast:sync`. Both use the same
 * parser (src/lib/podcast-feed.ts) and the same schema (src/data/podcast.ts).
 *
 * The feed is not read at build time on purpose. The symposium overlay
 * already establishes the rule -- the repository has to stand on its own --
 * and a nightly build that fails because anchor.fm is having a minute would
 * take the whole site down with it, for a podcast that publishes monthly.
 * A committed file also means the episode list is reviewable in a pull
 * request like everything else here.
 */
import { writeFileSync } from 'node:fs';
import { FEED, FeedError, parseFeed } from '../src/lib/podcast-feed';
import { podcastSchema } from '../src/data/podcast';

const OUT = new URL('../src/data/podcast.json', import.meta.url).pathname;

const response = await fetch(FEED, { headers: { 'User-Agent': 'rsg-turkiye-website/1.0' } });
if (!response.ok) {
  console.error(`Feed returned ${response.status}. src/data/podcast.json left as it is.`);
  process.exit(1);
}

let data;
try {
  data = parseFeed(await response.text(), new Date().toISOString());
} catch (e) {
  if (!(e instanceof FeedError)) throw e;
  console.error(`${e.message}. Nothing written.`);
  process.exit(1);
}
const checked = podcastSchema.safeParse(data);
if (!checked.success) {
  console.error(`The feed does not fit src/data/podcast.ts (${checked.error.issues.map((i) => i.path.join('.')).join(', ')}). Nothing written.`);
  process.exit(1);
}

writeFileSync(OUT, `${JSON.stringify(data, null, 2)}\n`);
console.log(`${data.episodes.length} episode(s) written to src/data/podcast.json`);
for (const e of data.episodes) {
  console.log(`  ${e.pubDate.slice(0, 10)}  ${Math.round(e.durationSeconds / 60)} min  ${e.title}`);
}
