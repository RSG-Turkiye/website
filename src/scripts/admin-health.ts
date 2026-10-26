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

/** As /api/admin/health sends it (functions/api/admin/health.ts, HealthUsage). */
export type HealthUsage = {
  configured: boolean;
  checkedAt: number | null; measuredAt: number | null; day: string | null;
  requests: number | null; rowsRead: number | null; rowsWritten: number | null;
  failed: boolean;
  error: string | null;
  agentRequests: number; agentWrites: number;
  limits: { requests: number; rowsRead: number; rowsWritten: number; agentRequests: number; agentWrites: number };
};

/** A check older than this is said to be stale: one missed hourly tick is not. */
const STALE_SECONDS = 3 * 3600;
/** Lines at or past this percent are bold, the first alert threshold. */
const WARN_PCT = 70;

function usageLine(label: string, value: number, limit: number, d: HealthDeps): string {
  const locale = d.lang === 'tr' ? 'tr-TR' : 'en-GB';
  const pct = Math.floor((value / limit) * 100);
  const text = `${label}: ${d.tf('admin.health.usage.value', { value: value.toLocaleString(locale), limit: limit.toLocaleString(locale), pct })}`;
  return `<p${pct >= WARN_PCT ? ' class="font-semibold"' : ''}>${escapeHtml(text)}</p>`;
}

/**
 * Today's free-tier usage, plain text lines (design pass later). The status
 * line says the first of: not set up, stale, failed, not measured yet today,
 * measured at. Failed comes before "not yet": a check that never worked (a
 * wrong GraphQL field name, a refused token) must say it failed, not that it
 * has not run. Cloudflare's numbers show only when they are today's (UTC).
 */
export function usageHtml(u: HealthUsage | null, d: HealthDeps, now: number): string {
  if (!u) return '';
  const today = new Date(now * 1000).toISOString().slice(0, 10);
  const measured = u.configured && u.day === today && u.requests !== null && u.rowsRead !== null && u.rowsWritten !== null;
  const lines: string[] = [];
  if (measured) {
    lines.push(usageLine(d.t('admin.health.usage.requests'), u.requests!, u.limits.requests, d));
    lines.push(usageLine(d.t('admin.health.usage.rowsRead'), u.rowsRead!, u.limits.rowsRead, d));
    lines.push(usageLine(d.t('admin.health.usage.rowsWritten'), u.rowsWritten!, u.limits.rowsWritten, d));
  }
  lines.push(usageLine(d.t('admin.health.usage.agentRequests'), u.agentRequests, u.limits.agentRequests, d));
  lines.push(usageLine(d.t('admin.health.usage.agentWrites'), u.agentWrites, u.limits.agentWrites, d));
  const at = (ts: number | null) => (ts ? formatDateTime(ts, d.lang) : '');
  let status: string;
  if (!u.configured) status = d.t('admin.health.usage.notSetUp');
  else if (u.checkedAt !== null && now - u.checkedAt > STALE_SECONDS) status = d.tf('admin.health.usage.stale', { time: at(u.checkedAt) });
  else if (u.failed) {
    status = u.error
      ? d.tf('admin.health.usage.failed', { time: at(u.checkedAt), error: u.error })
      : d.tf('admin.health.usage.failedNoDetail', { time: at(u.checkedAt) });
  } else if (!measured) status = d.t('admin.health.usage.notYet');
  else status = d.tf('admin.health.usage.asOf', { time: at(u.measuredAt) });
  return `<div class="mt-3 text-sm text-gray-700">
    <h3 class="text-xs font-semibold text-gray-500 mb-1">${escapeHtml(d.t('admin.health.usage.title'))}</h3>
    ${lines.join('')}
    <p class="text-xs text-gray-500 mt-1">${escapeHtml(status)}</p>
  </div>`;
}

type Health = { issues: Issue[]; canFix: boolean; usage?: HealthUsage | null };

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
  const usage = usageHtml(data.usage ?? null, d, Math.floor(Date.now() / 1000));
  if (data.issues.length === 0) {
    el.innerHTML = `<p class="text-sm text-gray-500">${escapeHtml(d.t('admin.overview.healthy'))}</p>${usage}`;
    return;
  }
  el.innerHTML = `<div class="rounded-2xl border border-red-200 bg-red-tint px-4 py-2 text-sm text-[#8a1c1c]">${lines(data, d)}</div>${usage}`;
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
