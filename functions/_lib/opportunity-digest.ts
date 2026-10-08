export interface DigestItem { id: string; title: string; url: string; source: string }
const DAY = 86400;

/** Titles come from other sites and pass through renderBody: defuse links, emphasis and bare URLs. */
export function mdSafe(s: string): string {
  return s
    .replace(/\s+/g, ' ')
    .replace(/\*/g, '\u2217')
    .replace(/\[/g, '(').replace(/\]/g, ')')
    .replace(/(https?):\/\//gi, '$1:/\u200B/')
    .trim();
}

/** The digest row is only queued for a user the mail dispatcher is allowed to send as. */
export function isDigestSender(row: { is_sender: number } | null | undefined): boolean {
  return !!row && row.is_sender === 1;
}

export async function buildDigest(
  published: DigestItem[],
  runs: { started_at: number; sources: string }[],
  removeUrl: (id: string) => Promise<string>,
  now: number,
): Promise<{ subject: string; body: string }> {
  const lines: string[] = [];
  const lastRun = Math.max(0, ...runs.map((r) => r.started_at));
  if (runs.length === 0) lines.push("⚠ Toplayıcı henüz hiç çalışmadı (collector has not run yet). Pi'yi kontrol edin.", '');
  else if (now - lastRun > 3 * DAY) lines.push(`⚠ Toplayıcı ${Math.floor((now - lastRun) / DAY)} gündür çalışmadı (collector did not run). Pi'yi kontrol edin.`, '');

  lines.push(`Bu hafta yayınlanan ilanlar: ${published.length}`, '');
  for (const p of published) lines.push(`• ${mdSafe(p.title)} (${p.source})`, `  ${p.url}`, `  Kaldır: ${await removeUrl(p.id)}`);

  const per: Record<string, { d7: number; d30: number; last: number; first: number }> = {};
  for (const r of runs) {
    const sources = JSON.parse(r.sources || '{}') as Record<string, { ingested?: number }>;
    for (const [name, s] of Object.entries(sources)) {
      const e = (per[name] ??= { d7: 0, d30: 0, last: 0, first: r.started_at });
      e.first = Math.min(e.first, r.started_at);
      const n = s.ingested ?? 0;
      if (now - r.started_at <= 7 * DAY) e.d7 += n;
      if (now - r.started_at <= 30 * DAY) e.d30 += n;
      if (n > 0) e.last = Math.max(e.last, r.started_at);
    }
  }
  lines.push('', 'Kaynak sağlığı (7 gün / 30 gün):');
  for (const [name, e] of Object.entries(per).sort()) {
    // Never ingested: only "silent" once the source has been polled for more than 14 days.
    const silent = e.last === 0
      ? (now - e.first > 14 * DAY ? '  ⚠ 14+ gündür sessiz (silent)' : '  henüz ilan getirmedi (nothing yet)')
      : now - e.last > 14 * DAY ? '  ⚠ 14+ gündür sessiz (silent)' : '';
    lines.push(`  ${name}: ${e.d7} / ${e.d30}${silent}`);
  }
  return { subject: `RSG fırsatları: bu hafta ${published.length} ilan`, body: lines.join('\n') };
}
