/**
 * The status banner above every admin pane. Says what is broken, what that
 * stops, and either offers the fix (admins) or says who can fix it.
 */
import { escapeHtml } from './escape-html';
import { formatDateTime } from './format-time';

export interface HealthDeps {
  t: (key: string) => string;
  tf: (key: string, vars: Record<string, string | number>) => string;
  lang: 'en' | 'tr';
}

type Issue =
  | { kind: 'connection'; platform: string; status: 'expiring' | 'broken'; expiresAt: number | null; lastError: string | null }
  | { kind: 'scheduler'; lastRunAt: number | null };

const RUNBOOK = 'https://github.com/RSG-Turkiye/website#connections-and-the-status-banner';

function message(i: Issue, d: HealthDeps): string {
  if (i.kind === 'scheduler') {
    return i.lastRunAt ? d.tf('admin.health.scheduler', { time: formatDateTime(i.lastRunAt, d.lang) }) : d.t('admin.health.schedulerNever');
  }
  const platform = d.t(`admin.connections.platform.${i.platform}`);
  if (i.status === 'expiring') {
    return d.tf('admin.health.connection.expiring', { platform, date: i.expiresAt ? formatDateTime(i.expiresAt, d.lang) : '' });
  }
  const effect = d.t(i.platform === 'gmail' ? 'admin.health.effect.gmail' : 'admin.health.effect.social');
  return `${d.tf('admin.health.connection.broken', { platform })} ${effect}`;
}

function action(i: Issue, canFix: boolean, d: HealthDeps): string {
  if (i.kind === 'scheduler') {
    return `<a href="${RUNBOOK}" target="_blank" rel="noopener" class="shrink-0 text-xs font-medium underline">${escapeHtml(d.t('admin.health.howTo'))}</a>`;
  }
  return canFix
    ? `<button type="button" data-fix class="shrink-0 px-3 py-1 rounded-lg bg-red text-white text-xs font-semibold hover:bg-red-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy-mid">${escapeHtml(d.t('admin.health.fix'))}</button>`
    : `<span class="shrink-0 text-xs">${escapeHtml(d.t('admin.health.adminCanFix'))}</span>`;
}

type Health = { issues: Issue[]; canFix: boolean };

// The last answer, kept so Overview can show it whichever of the two (this
// check or Overview's own render) finishes first.
let last: { data: Health; d: HealthDeps } | null = null;

function lines(data: Health, d: HealthDeps): string {
  return data.issues
    .map((i) => `<div class="flex items-center justify-between gap-3 py-1.5"><span>⚠ ${escapeHtml(message(i, d))}</span>${action(i, data.canFix, d)}</div>`)
    .join('');
}

function wireFix(el: HTMLElement): void {
  el.querySelectorAll<HTMLButtonElement>('[data-fix]').forEach((b) =>
    b.addEventListener('click', () => { location.hash = '#baglantilar'; }),
  );
}

/** Fills Overview's System block, once Overview is on the page and the check has answered. */
export function renderOverviewHealth(): void {
  const el = document.getElementById('overviewHealth');
  if (!el || !last) return;
  const { data, d } = last;
  if (data.issues.length === 0) {
    el.innerHTML = `<p class="text-sm text-gray-500">${escapeHtml(d.t('admin.overview.healthy'))}</p>`;
    return;
  }
  el.innerHTML = `<div class="rounded-2xl border border-red-200 bg-red-tint px-4 py-2 text-sm text-[#8a1c1c]">${lines(data, d)}</div>`;
  wireFix(el);
}

export async function loadHealth(d: HealthDeps): Promise<void> {
  const el = document.getElementById('healthBanner');
  if (!el) return;
  let data: Health;
  try {
    const res = await fetch('/api/admin/health');
    if (!res.ok) return;
    data = await res.json();
  } catch {
    return;
  }
  last = { data, d };
  renderOverviewHealth();
  if (data.issues.length === 0) {
    el.classList.add('hidden');
    el.replaceChildren();
    return;
  }
  el.innerHTML = lines(data, d);
  el.classList.remove('hidden');
  wireFix(el);
}
