import { escapeHtml } from '../../escape-html';
import { t, formatDate } from '../context';
import { row, chip, emptyState, toast } from '../ui-kit';
import { defaultSentScope, type SentScope } from '../sections';

let scope: SentScope = 'mine';
// The scope of the list on screen (null: nothing listed yet). A failed
// switch puts the toggle back to it, so the label always names the list.
let shownScope: SentScope | null = null;
let isAdmin = false;
let wired = false;
let token = 0;
// True until a load succeeds, and again after a send: the next show reloads.
let stale = true;

/**
 * Admins get the Mine/Everyone toggle; senders only ever see their own. An
 * admin who cannot send has nothing of their own, so they start on Everyone.
 */
export function setSentAdmin(admin: boolean, sender: boolean) {
  isAdmin = admin;
  scope = defaultSentScope(admin, sender);
}

/** A send went out: the list is out of date and reloads when it next shows. */
export function markSentStale(): void {
  stale = true;
}

function paintToggle() {
  document.querySelectorAll<HTMLButtonElement>('#sentScope [data-scope]').forEach((b) => {
    const on = b.dataset.scope === scope;
    b.setAttribute('aria-pressed', String(on));
    b.classList.toggle('bg-navy', on);
    b.classList.toggle('text-white', on);
    b.classList.toggle('bg-[#F7F7F6]', !on);
    b.classList.toggle('text-gray-500', !on);
  });
}

function wire() {
  if (wired) return;
  wired = true;
  document.getElementById('sentScope')!.classList.toggle('hidden', !isAdmin);
  paintToggle();
  document.querySelectorAll<HTMLButtonElement>('#sentScope [data-scope]').forEach((b) => {
    b.addEventListener('click', () => {
      scope = b.dataset.scope === 'all' ? 'all' : 'mine';
      paintToggle();
      void loadSent();
    });
  });
}

/** Runs on every show of the sub-page: loads the first time, and again when stale. */
export function showSent(): void {
  if (stale) void loadSent();
}

async function loadSent(): Promise<void> {
  wire();
  stale = false;
  const mine = ++token;
  const wanted = isAdmin ? scope : 'mine';
  let data: { sends: any[] };
  try {
    const res = await fetch(wanted === 'all' ? '/api/mail/history?scope=all' : '/api/mail/history');
    if (!res.ok) throw new Error(String(res.status));
    data = await res.json();
  } catch {
    if (mine !== token) return;
    stale = true;
    toast(t('admin.mail.sent.loadFailed'), true);
    // The toggle goes back to the list still on screen; with none, the list stays empty.
    if (shownScope !== null) { scope = shownScope; paintToggle(); }
    return;
  }
  if (mine !== token) return;
  shownScope = wanted;
  const list = document.getElementById('sentList')!;
  const sends = data.sends ?? [];
  if (!sends.length) {
    list.innerHTML = emptyState(t('admin.mail.sent.empty'));
    return;
  }
  const everyone = wanted === 'all';
  list.innerHTML = sends.map((s: any) => {
    const to = s.recipient_name ? `${s.recipient_name} <${s.recipient_email}>` : s.recipient_email;
    const who = everyone ? `${s.sender_name ?? s.sender_email} → ` : '';
    return row({
      title: s.subject,
      subtitle: `${who}${to} · ${formatDate(s.sent_at)}`,
      chips: s.status === 'failed'
        ? chip(t('admin.mail.sent.failed'), 'red') + (s.error_message ? `<span class="text-xs text-red-600 min-w-0 break-all">${escapeHtml(s.error_message)}</span>` : '')
        : '',
    });
  }).join('');
}
