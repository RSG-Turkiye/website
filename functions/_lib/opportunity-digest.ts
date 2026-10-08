export interface DigestItem { id: string; title: string; url: string; source: string }
const DAY = 86400;

export async function buildDigest(
  published: DigestItem[],
  runs: { started_at: number; sources: string }[],
  removeUrl: (id: string) => Promise<string>,
  now: number,
): Promise<{ subject: string; body: string }> {
  const lines: string[] = [];
  const lastRun = Math.max(0, ...runs.map((r) => r.started_at));
  if (now - lastRun > 3 * DAY) lines.push(`⚠ Toplayıcı ${Math.floor((now - lastRun) / DAY)} gündür çalışmadı (collector did not run). Pi'yi kontrol edin.`, '');

  lines.push(`Bu hafta yayınlanan ilanlar: ${published.length}`, '');
  for (const p of published) lines.push(`• ${p.title} [${p.source}]`, `  ${p.url}`, `  Kaldır: ${await removeUrl(p.id)}`);

  const per: Record<string, { d7: number; d30: number; last: number }> = {};
  for (const r of runs) {
    const sources = JSON.parse(r.sources || '{}') as Record<string, { ingested?: number }>;
    for (const [name, s] of Object.entries(sources)) {
      const e = (per[name] ??= { d7: 0, d30: 0, last: 0 });
      const n = s.ingested ?? 0;
      if (now - r.started_at <= 7 * DAY) e.d7 += n;
      if (now - r.started_at <= 30 * DAY) e.d30 += n;
      if (n > 0) e.last = Math.max(e.last, r.started_at);
    }
  }
  lines.push('', 'Kaynak sağlığı (7 gün / 30 gün):');
  for (const [name, e] of Object.entries(per).sort()) {
    const silent = now - e.last > 14 * DAY ? '  ⚠ 14+ gündür sessiz (silent)' : '';
    lines.push(`  ${name}: ${e.d7} / ${e.d30}${silent}`);
  }
  return { subject: `RSG fırsatları: bu hafta ${published.length} ilan`, body: lines.join('\n') };
}
