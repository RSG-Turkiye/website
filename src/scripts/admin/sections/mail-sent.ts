import { escapeHtml } from '../../escape-html';
import { t, formatDate } from '../context';
import { row, chip, emptyState } from '../ui-kit';

type Scope = 'mine' | 'all';

let scope: Scope = 'mine';
let isAdmin = false;
let wired = false;
let token = 0;

/** Admins get the Mine/Everyone toggle; senders only ever see their own. */
export function setSentAdmin(admin: boolean) {
  isAdmin = admin;
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
  document.querySelectorAll<HTMLButtonElement>('#sentScope [data-scope]').forEach((b) => {
    b.addEventListener('click', () => {
      scope = b.dataset.scope === 'all' ? 'all' : 'mine';
      paintToggle();
      void loadSent();
    });
  });
}

export async function loadSent(): Promise<void> {
  wire();
  const mine = ++token;
  const everyone = isAdmin && scope === 'all';
  const res = await fetch(everyone ? '/api/mail/history?scope=all' : '/api/mail/history');
  if (!res.ok || mine !== token) return;
  const data = await res.json() as { sends: any[] };
  if (mine !== token) return;
  const list = document.getElementById('sentList')!;
  if (!data.sends.length) {
    list.innerHTML = emptyState(t('admin.mail.sent.empty'));
    return;
  }
  list.innerHTML = data.sends.map((s: any) => {
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
