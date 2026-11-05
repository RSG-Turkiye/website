/**
 * Panel › E-posta › Toplu gönderim: bulk personal mail
 * (docs/superpowers/specs/2026-11-05-bulk-personal-mail-design.md).
 *
 * The check below the form is built with the same buildCampaign the server
 * runs on the request, so what the preview shows is what is queued.
 */
import { escapeHtml } from '../../escape-html';
import { t, tf, formatDate } from '../context';
import { row, chip, emptyState, toast } from '../ui-kit';
import { buildCampaign, parseTable, type CampaignBuild } from '../../../lib/mail-campaign';
import { CAMPAIGN_LIMITS } from '../../../../functions/_lib/mail';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

let wired = false;
let current: CampaignBuild | null = null;
let armTimer: ReturnType<typeof setTimeout> | null = null;

function sendLabel(n: number) { return tf('admin.mail.bulk.send', { n }); }

function disarm() {
  const send = $<HTMLButtonElement>('mailBulkSend');
  send.dataset.armed = '';
  if (armTimer) { clearTimeout(armTimer); armTimer = null; }
  send.textContent = current?.ok ? sendLabel(current.recipients.length) : t('admin.mail.compose.send');
}

/** Rebuilds the check on every keystroke: nothing is sent from here. */
function check() {
  disarm();
  const table = $<HTMLTextAreaElement>('mailBulkTable').value;
  const subject = $<HTMLInputElement>('mailBulkSubject').value;
  const body = $<HTMLTextAreaElement>('mailBulkBody').value;

  const parsed = parseTable(table);
  const usable = parsed.headers.filter((h) => h && h !== parsed.emailColumn);
  const columns = $('mailBulkColumns');
  columns.classList.toggle('hidden', usable.length === 0);
  columns.textContent = tf('admin.mail.bulk.columns', { list: usable.map((h) => `[${h}]`).join(' ') });

  const send = $<HTMLButtonElement>('mailBulkSend');
  const box = $('mailBulkCheck');
  const nothingYet = !table.trim() && !subject.trim() && !body.trim();
  box.classList.toggle('hidden', nothingYet);
  current = nothingYet ? null : buildCampaign({ table, subject, body });

  const error = $('mailBulkError');
  const summary = $('mailBulkSummary');
  const refusedWrap = $('mailBulkRefusedWrap');
  const previewWrap = $('mailBulkPreviewWrap');
  if (!current || !current.ok) {
    send.disabled = true;
    send.textContent = t('admin.mail.compose.send');
    summary.classList.add('hidden');
    refusedWrap.classList.add('hidden');
    previewWrap.classList.add('hidden');
    error.classList.toggle('hidden', !current);
    if (current && !current.ok) {
      error.textContent = current.code === 'unknown_placeholder'
        ? tf('admin.mail.bulk.error.unknown_placeholder', { list: (current.unknown ?? []).map((u) => `[${u}]`).join(', ') })
        : t(`admin.mail.bulk.error.${current.code}` as never);
    }
    return;
  }

  error.classList.add('hidden');
  const n = current.recipients.length;
  summary.classList.remove('hidden');
  summary.textContent = tf('admin.mail.bulk.summary', { n, days: Math.max(1, Math.ceil(n / CAMPAIGN_LIMITS.perDay)) });

  refusedWrap.classList.toggle('hidden', current.refused.length === 0);
  $('mailBulkRefusedSummary').textContent = tf('admin.mail.bulk.refusedHeading', { n: current.refused.length });
  $('mailBulkRefused').innerHTML = current.refused.map((r) =>
    `<li>${escapeHtml(tf(`admin.mail.bulk.refused.${r.reason}` as never, { line: r.line, email: r.email || '—', field: r.field ?? '' }))}</li>`).join('');

  previewWrap.classList.remove('hidden');
  $('mailBulkPreview').innerHTML = current.recipients.slice(0, 3).map((r) => `
    <div class="rounded-xl border border-border bg-[#F7F7F6] p-3 lg:p-2 min-w-0">
      <p class="text-xs text-gray-500 break-all">${escapeHtml(t('admin.mail.bulk.previewTo'))}: ${escapeHtml(r.email)}</p>
      <p class="text-sm font-medium text-navy break-words mt-1">${escapeHtml(r.subject)}</p>
      <p class="text-sm text-gray-700 whitespace-pre-wrap break-words mt-2">${escapeHtml(r.body)}</p>
    </div>`).join('');

  send.disabled = false;
  send.textContent = sendLabel(n);
}

async function start() {
  const send = $<HTMLButtonElement>('mailBulkSend');
  const status = $('mailBulkStatus');
  send.disabled = true;
  try {
    const res = await fetch('/api/mail/campaigns', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        table: $<HTMLTextAreaElement>('mailBulkTable').value,
        subject: $<HTMLInputElement>('mailBulkSubject').value,
        body: $<HTMLTextAreaElement>('mailBulkBody').value,
      }),
    });
    if (!res.ok) throw new Error(String(res.status));
    const out = await res.json() as { total: number };
    toast(tf('admin.mail.bulk.queued', { n: out.total }));
    status.textContent = '';
    // The letters are in the queue now; clearing the form is what stops a
    // second click from queueing everyone twice.
    for (const id of ['mailBulkTable', 'mailBulkSubject', 'mailBulkBody']) $<HTMLInputElement>(id).value = '';
    check();
    void loadCampaigns();
  } catch {
    toast(t('admin.mail.bulk.startFailed'), true);
    send.disabled = false;
  }
}

function wire() {
  if (wired) return;
  wired = true;
  for (const id of ['mailBulkTable', 'mailBulkSubject', 'mailBulkBody']) $(id).addEventListener('input', check);
  // Two clicks, with the count in the second label: a mail-out cannot be
  // taken back once it starts going, so the number is read before it goes.
  $<HTMLButtonElement>('mailBulkSend').addEventListener('click', () => {
    if (!current?.ok) return;
    const send = $<HTMLButtonElement>('mailBulkSend');
    if (send.dataset.armed !== '1') {
      send.dataset.armed = '1';
      send.textContent = tf('admin.mail.bulk.confirm', { n: current.recipients.length });
      armTimer = setTimeout(disarm, 4000);
      return;
    }
    disarm();
    void start();
  });
  $('mailBulkList').addEventListener('click', (e) => {
    const button = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-cancel]');
    if (!button) return;
    if (button.dataset.armed !== '1') {
      button.dataset.armed = '1';
      button.textContent = tf('admin.mail.bulk.cancelConfirm', { n: Number(button.dataset.waiting) });
      setTimeout(() => { button.dataset.armed = ''; button.textContent = t('admin.mail.bulk.cancel'); }, 4000);
      return;
    }
    void cancel(button.dataset.cancel!, button);
  });
}

async function cancel(id: string, button: HTMLButtonElement) {
  button.disabled = true;
  try {
    const res = await fetch(`/api/mail/campaigns/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (!res.ok) throw new Error(String(res.status));
    const out = await res.json() as { dropped: number };
    toast(tf('admin.mail.bulk.cancelDone', { n: out.dropped }));
  } catch {
    toast(t('admin.mail.bulk.cancelFailed'), true);
  }
  void loadCampaigns();
}

interface Campaign {
  id: string; subject: string; total: number; created_at: number; cancelled_at: number | null;
  sender_email?: string; sent: number; failed: number; waiting: number; held: string | null;
}

async function loadCampaigns() {
  const list = $('mailBulkList');
  let campaigns: Campaign[];
  try {
    const res = await fetch('/api/mail/campaigns');
    if (!res.ok) throw new Error(String(res.status));
    campaigns = ((await res.json()) as { campaigns: Campaign[] }).campaigns ?? [];
  } catch {
    toast(t('admin.mail.bulk.loadFailed'), true);
    return;
  }
  if (!campaigns.length) { list.innerHTML = emptyState(t('admin.mail.bulk.empty')); return; }
  list.innerHTML = campaigns.map((c) => {
    const who = c.sender_email ? `${c.sender_email} · ` : '';
    const progress = tf('admin.mail.bulk.progress', { sent: c.sent, waiting: c.waiting, failed: c.failed });
    const heldKey = c.held && ['rate_limit_campaign_day', 'rate_limit_campaign_hour', 'rate_limit_global'].includes(c.held)
      ? `admin.mail.bulk.held.${c.held}` : null;
    // Progress sits on the chips line, which wraps, rather than in the
    // subtitle, which truncates: on a phone the counts are what got cut.
    const chips = [
      `<span class="text-xs text-gray-600">${escapeHtml(progress)}</span>`,
      c.cancelled_at ? chip(t('admin.mail.bulk.cancelled'), 'neutral') : '',
      c.failed ? chip(String(c.failed), 'red') : '',
      heldKey && c.waiting ? chip(t(heldKey as never), 'amber') : '',
    ].join('');
    const trailing = c.waiting && !c.cancelled_at
      ? `<button type="button" data-cancel="${escapeHtml(c.id)}" data-waiting="${c.waiting}" class="inline-flex items-center justify-center px-4 lg:px-3 min-h-11 lg:min-h-9 rounded-xl text-sm font-medium border border-navy text-navy hover:bg-navy-light focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy-mid disabled:opacity-40">${escapeHtml(t('admin.mail.bulk.cancel'))}</button>`
      : '';
    return row({ title: c.subject, subtitle: `${who}${formatDate(c.created_at)}`, chips, trailing, stack: true });
  }).join('');
}

/** Runs on every show of the sub-page. */
export function showCampaigns(): void {
  wire();
  check();
  void loadCampaigns();
}
