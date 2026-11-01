import type { Env } from '../../../_lib/auth';
import { jsonResponse } from '../../../_lib/auth';
import { runWithAudit } from '../../../_lib/audit';
import { safeEqual } from '../../../_lib/secret';
import { pageText, fingerprint, changedLines, MIN_TEXT, PASS_NIGHTS, MAX_PER_NIGHT } from '../../../_lib/page-watch';

/**
 * Nightly (workers/symposium-cron): the announcement-page watch. Every
 * programme's announcement and calendar URL (from /guide/catalog.json) is
 * tracked once, however many programmes share it. Each night a seventh of
 * them (oldest first, at most 25) is fetched, so each page is seen about
 * weekly. A page whose text is not one of its last three fingerprints puts a
 * "page changed" row in the guide's suggestion queue with the new lines; a
 * person opens the link and enters what they see. The first sighting only
 * records a baseline. A page that is not 200 or is nearly empty is
 * "unreadable": counted, never a change.
 */

interface Catalog { programmes: { id: string; announcementUrl?: string; calendarUrl?: string }[] }
interface WatchRow { url: string; programme_ids: string; fingerprints: string; last_text: string | null; failures: number }

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!safeEqual(request.headers.get('X-Archive-Secret'), env.SYMPOSIUM_ARCHIVE_SECRET)) {
    return jsonResponse({ error: 'Forbidden', code: 'forbidden' }, 403);
  }
  const now = Math.floor(Date.now() / 1000);
  const res = await env.ASSETS?.fetch(new Request('https://assets.local/guide/catalog.json')).catch(() => null);
  if (!res?.ok) return jsonResponse({ error: 'catalog unavailable', code: 'no_catalog' }, 503);
  const catalog = (await res.json()) as Catalog;

  const byUrl = new Map<string, string[]>();
  for (const p of catalog.programmes) for (const u of [p.announcementUrl, p.calendarUrl]) if (u) byUrl.set(u, [...(byUrl.get(u) ?? []), p.id]);
  await env.DB.batch([...byUrl].map(([url, ids]) => env.DB.prepare(
    `INSERT INTO guide_page_watch (url, programme_ids) VALUES (?, ?)
     ON CONFLICT(url) DO UPDATE SET programme_ids = excluded.programme_ids`,
  ).bind(url, JSON.stringify(ids))));
  // One JSON parameter, not one per URL: D1 refuses more than 100 bound parameters.
  await env.DB.prepare('DELETE FROM guide_page_watch WHERE url NOT IN (SELECT value FROM json_each(?))').bind(JSON.stringify([...byUrl.keys()])).run();

  const live = await env.DB.prepare('SELECT COUNT(*) AS n FROM guide_page_watch WHERE muted = 0').first<{ n: number }>();
  const take = Math.min(MAX_PER_NIGHT, Math.ceil(Number(live?.n ?? 0) / PASS_NIGHTS));
  const { results } = await env.DB.prepare(
    'SELECT url, programme_ids, fingerprints, last_text, failures FROM guide_page_watch WHERE muted = 0 ORDER BY checked_at IS NOT NULL, checked_at, url LIMIT ?',
  ).bind(take).all<WatchRow>();

  const writes: D1PreparedStatement[] = [];
  let changed = 0;
  let unreadable = 0;
  for (const w of results ?? []) {
    let text = '';
    let binary = false;
    try {
      const page = await fetch(w.url, { signal: AbortSignal.timeout(10_000), headers: { 'User-Agent': 'RSG-Turkiye guide page watch (+https://rsg-turkiye.iscbsc.org/guide/)' } });
      if (page.ok) {
        const type = page.headers.get('Content-Type') ?? '';
        const bytes = new Uint8Array(await page.arrayBuffer());
        // A PDF (some calendars are) is compared as bytes: a change is still
        // noticed, but there are no readable lines to show.
        if (/html|text\//i.test(type)) text = pageText(bytes, type);
        else if (bytes.length >= MIN_TEXT) { binary = true; text = `binary:${await fingerprint(Array.from(bytes, (b) => String.fromCharCode(b)).join(''))}`; }
      }
    } catch { /* unreadable below */ }
    if (!binary && text.length < MIN_TEXT) {
      unreadable++;
      writes.push(env.DB.prepare("UPDATE guide_page_watch SET checked_at = ?, failures = failures + 1, state = 'unreadable' WHERE url = ?").bind(now, w.url));
      continue;
    }
    const fp = await fingerprint(text);
    const seen = JSON.parse(w.fingerprints || '[]') as string[];
    if (seen.length && !seen.includes(fp)) {
      changed++;
      const ids = JSON.parse(w.programme_ids || '[]') as string[];
      writes.push(env.DB.prepare(
        "INSERT OR IGNORE INTO intake_rows (source, row_key, record_id, kind, payload, status, count, created_at) VALUES ('guide', ?, ?, 'page_changed', ?, 'new', 1, ?)",
      ).bind(`watch:${w.url}:${fp}`, ids[0] ?? '', JSON.stringify({ text: binary ? '' : changedLines(w.last_text ?? '', text).join('\n'), link: w.url }), now));
    }
    const keep = seen.includes(fp) ? seen : [fp, ...seen].slice(0, 3);
    writes.push(env.DB.prepare("UPDATE guide_page_watch SET fingerprints = ?, last_text = ?, checked_at = ?, failures = 0, state = 'ok' WHERE url = ?")
      .bind(JSON.stringify(keep), binary ? '' : text.slice(0, 20000), now, w.url));
  }
  await runWithAudit(env.DB, writes, { userId: null, action: 'guide.watch', details: { checked: results?.length ?? 0, changed, unreadable } }, now);
  return jsonResponse({ checked: results?.length ?? 0, changed, unreadable });
};
