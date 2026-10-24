/** Overview: waiting work, health, and what is coming up, limited to what the roles may see. */
import { row } from './ui-kit';
import { t, tf } from './context';
import { escapeHtml } from '../escape-html';
import { renderOverviewHealth } from '../admin-health';

const CARDS: { key: string; section: string; label: string }[] = [
  { key: 'email', section: 'eposta', label: 'admin.overview.email' },
  { key: 'social', section: 'sosyal/onay', label: 'admin.overview.social' },
  { key: 'dm', section: 'sosyal/dm', label: 'admin.overview.dm' },
  { key: 'blog', section: 'blog', label: 'admin.overview.blog' },
  { key: 'cmsQueue', section: 'icerik/onay', label: 'admin.overview.cmsQueue' },
  { key: 'cmsMine', section: 'icerik/taslaklar', label: 'admin.overview.cmsMine' },
];

export async function loadOverview(): Promise<void> {
  const host = document.getElementById('overview');
  if (!host) return;
  let counts: Record<string, number> = {};
  try { const r = await fetch('/api/admin/counts'); if (r.ok) counts = await r.json(); } catch { /* empty overview */ }
  const waiting = CARDS.filter((c) => (counts[c.key] ?? 0) > 0)
    .map((c) => `<a href="#${c.section}" class="block">${row({ title: tf(c.label as never, { n: counts[c.key] }), trailing: '<span aria-hidden="true">›</span>' })}</a>`).join('');
  const upcoming = counts.scheduledThisWeek !== undefined
    ? `<a href="#sosyal/takvim" class="block">${row({ title: tf('admin.overview.scheduled' as never, { n: counts.scheduledThisWeek }), trailing: '<span aria-hidden="true">›</span>' })}</a>` : '';
  host.innerHTML = `
    <h2 class="text-sm font-semibold text-navy mb-2">${escapeHtml(t('admin.overview.waiting' as never))}</h2>
    <div class="flex flex-col gap-2 mb-6 lg:mb-4">${waiting || `<p class="text-sm text-gray-500">${escapeHtml(t('admin.overview.nothingWaiting' as never))}</p>`}</div>
    <h2 class="text-sm font-semibold text-navy mb-2">${escapeHtml(t('admin.overview.health' as never))}</h2>
    <div id="overviewHealth" class="mb-6 lg:mb-4"></div>
    ${upcoming ? `<h2 class="text-sm font-semibold text-navy mb-2">${escapeHtml(t('admin.overview.upcoming' as never))}</h2><div class="flex flex-col gap-2">${upcoming}</div>` : ''}`;
  renderOverviewHealth();
}
