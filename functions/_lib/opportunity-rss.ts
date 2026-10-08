export interface PublicItem {
  id: string; url: string; title: string; title_tr: string; summary_tr: string; source: string; type: string;
  levels: string[]; deadline: number | null; starts_at: number | null; country: string; online: boolean;
  cost_note: string; eligibility_note: string; published_at: number; expires_at: number;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function renderRss(items: PublicItem[], siteUrl: string): string {
  const entries = items.map((i) => `
    <item>
      <title>${esc(i.title_tr || i.title)}</title>
      <link>${esc(i.url)}</link>
      <guid isPermaLink="false">${esc(i.id)}</guid>
      <pubDate>${new Date(i.published_at * 1000).toUTCString()}</pubDate>
      <description>${esc(i.summary_tr || i.title)}</description>
    </item>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <title>RSG-Türkiye fırsatları</title>
  <link>${esc(siteUrl)}/tr/firsatlar</link>
  <description>Biyoinformatik öğrencileri için burslar, pozisyonlar, kurslar ve hackathonlar</description>${entries}
</channel></rss>`;
}
