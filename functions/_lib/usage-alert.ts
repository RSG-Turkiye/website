/**
 * The free-tier usage alert mail (functions/_lib/usage.ts sends it). Turkish
 * first, then English, as the other system mails in social-notify.ts: the
 * reader's language is not known. Nothing a person wrote goes into it, only
 * numbers and fixed text, so `text` is safe to render as Markdown.
 */
import type { SystemMessage } from './social-notify';
import type { Crossing, Metric } from './usage';

const NAMES: Record<Metric, { tr: string; en: string }> = {
  requests: { tr: 'Worker istekleri', en: 'Worker requests' },
  rowsRead: { tr: 'D1 okunan satır', en: 'D1 rows read' },
  rowsWritten: { tr: 'D1 yazılan satır', en: 'D1 rows written' },
};

/** What stops at 100%, for every metric in the mail. */
const AT_LIMIT: Record<Metric, { tr: string; en: string }> = {
  requests: { tr: 'her API çağrısı başarısız olur', en: 'every API call fails' },
  rowsRead: { tr: 'her D1 okuması başarısız olur', en: 'every D1 read fails' },
  rowsWritten: { tr: 'her D1 yazması başarısız olur', en: 'every D1 write fails' },
};

const pct = (c: Crossing) => Math.floor((c.value / c.limit) * 100);

export function usageAlertMessage(list: Crossing[], panelUrl: string): SystemMessage {
  const top = Math.max(...list.map((c) => c.threshold));
  // One line per metric, at the highest threshold it passed this time.
  const metrics = [...new Set(list.map((c) => c.metric))];
  const highest = (m: Metric) => list.filter((c) => c.metric === m).reduce((a, b) => (b.threshold > a.threshold ? b : a));
  const tr = metrics.map((m) => {
    const c = highest(m);
    return `- ${NAMES[m].tr}: ${c.value.toLocaleString('tr-TR')} / ${c.limit.toLocaleString('tr-TR')} (%${pct(c)}), %${c.threshold} sınırı geçildi`;
  });
  const en = metrics.map((m) => {
    const c = highest(m);
    return `- ${NAMES[m].en}: ${c.value.toLocaleString('en-GB')} / ${c.limit.toLocaleString('en-GB')} (${pct(c)}%), passed ${c.threshold}%`;
  });
  const stopsTr = metrics.map((m) => AT_LIMIT[m].tr).join('; ');
  const stopsEn = metrics.map((m) => AT_LIMIT[m].en).join('; ');
  return {
    subject: `Ücretsiz kota %${top} sınırını geçti / Free-tier usage passed ${top}%`,
    text: [
      'Cloudflare ücretsiz planının bugünkü (UTC) kullanımı:',
      '',
      ...tr,
      '',
      `%100'e ulaşırsa ${stopsTr}; sayaçlar 00:00 UTC'de (Türkiye saatiyle 03:00) sıfırlanana kadar.`,
      '',
      `Panel: ${panelUrl}`,
      '',
      '---',
      '',
      "Today's (UTC) usage of the Cloudflare free plan:",
      '',
      ...en,
      '',
      `At 100%, ${stopsEn}, until the counters reset at 00:00 UTC (03:00 in Türkiye).`,
      '',
      `Panel: ${panelUrl}`,
    ].join('\n'),
  };
}
