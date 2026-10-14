/** The Log pane (admins only): filter, page back, export, verify. */
import { escapeHtml } from './escape-html';
import { formatDateTime } from './format-time';
import { row as uiRow, emptyState } from './admin/ui-kit';

export interface AuditDeps {
  t: (key: string) => string;
  tf: (key: string, vars: Record<string, string | number>) => string;
  showToast: (message: string, isError?: boolean) => void;
  lang: 'en' | 'tr';
}

type Row = { seq: number; at: number; user_email: string | null; action: string; target_type: string | null; target_id: string | null; details: string };

let deps: AuditDeps;
let oldestSeq: number | null = null;
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/** Date inputs are days in Türkiye time; the API wants unix seconds. */
function dayStart(value: string): number | null {
  return value ? Math.floor(new Date(`${value}T00:00:00+03:00`).getTime() / 1000) : null;
}

function filters(): URLSearchParams {
  const q = new URLSearchParams();
  const user = $<HTMLInputElement>('auditUser').value.trim();
  const action = $<HTMLInputElement>('auditAction').value.trim();
  const from = dayStart($<HTMLInputElement>('auditFrom').value);
  const toStart = dayStart($<HTMLInputElement>('auditTo').value);
  if (user) q.set('user', user);
  if (action) q.set('action', action);
  if (from !== null) q.set('from', String(from));
  if (toStart !== null) q.set('to', String(toStart + 86399));
  return q;
}

function row(r: Row): string {
  const target = [r.target_type, r.target_id].filter(Boolean).join(': ');
  const who = r.user_email ?? deps.t('admin.audit.system');
  const subtitle = [formatDateTime(r.at, deps.lang), who, target].filter(Boolean).join(' · ');
  const card = uiRow({ title: r.action, subtitle });
  if (r.details === '{}') return card;
  // Details sit in a disclosure beneath the row, so a long payload never widens the page.
  return `<div>${card}<details class="mt-1 px-4"><summary class="cursor-pointer text-xs text-gray-500 min-h-11 lg:min-h-0 flex items-center">${escapeHtml(deps.t('admin.audit.col.details'))}</summary><pre class="whitespace-pre-wrap break-all text-xs text-gray-600 pb-2">${escapeHtml(r.details)}</pre></details></div>`;
}

export async function loadAudit(more = false): Promise<void> {
  const q = filters();
  if (more && oldestSeq !== null) q.set('before', String(oldestSeq));
  const res = await fetch(`/api/admin/audit?${q}`);
  if (!res.ok) {
    deps.showToast(deps.t('admin.audit.loadFailed'), true);
    return;
  }
  const { rows, hasMore } = await res.json() as { rows: Row[]; hasMore: boolean };
  const body = $('auditBody');
  const html = rows.map(row).join('');
  if (more) body.insertAdjacentHTML('beforeend', html);
  else body.innerHTML = html || emptyState(deps.t('admin.audit.empty'));
  if (rows.length) oldestSeq = rows[rows.length - 1].seq;
  $('auditMore').classList.toggle('hidden', !hasMore);
}

async function verify(): Promise<void> {
  const button = $<HTMLButtonElement>('auditVerify');
  const out = $('auditVerifyResult');
  button.disabled = true;
  try {
    const res = await fetch('/api/admin/audit/verify', { method: 'POST' });
    const r = await res.json() as { ok: boolean; checked: number; anchoredAfterPrune?: boolean; brokenAt?: number };
    out.textContent = r.ok
      ? `${deps.tf('admin.audit.verifyOk', { count: r.checked })}${r.anchoredAfterPrune ? ` ${deps.t('admin.audit.verifyPruned')}` : ''}`
      : deps.tf('admin.audit.verifyBroken', { seq: r.brokenAt ?? '?' });
    out.className = `text-sm mt-2 ${r.ok ? 'text-green-700' : 'text-red-600 font-semibold'}`;
  } finally {
    button.disabled = false;
  }
}

export function setupAudit(d: AuditDeps): void {
  deps = d;
  $('auditFilter').addEventListener('submit', (e) => {
    e.preventDefault();
    oldestSeq = null;
    void loadAudit();
  });
  $('auditMore').addEventListener('click', () => void loadAudit(true));
  $('auditExportCsv').addEventListener('click', () => { const q = filters(); q.set('format', 'csv'); location.href = `/api/admin/audit/export?${q}`; });
  $('auditExportJson').addEventListener('click', () => { const q = filters(); q.set('format', 'json'); location.href = `/api/admin/audit/export?${q}`; });
  $('auditVerify').addEventListener('click', () => void verify());
}
