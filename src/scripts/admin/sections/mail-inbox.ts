/**
 * The E-posta pane's Inbox sub-page: the conversations list and the thread
 * view, moved here from /account/conversations. Same requests as that page.
 * The open thread lives in the address (`#eposta/gelen/<id>`), so back and
 * forward move between threads and a link opens one. On a laptop the list
 * and the thread sit side by side; on a phone the list shows alone and a
 * thread replaces it, with ‹ back to the list.
 */
import { escapeHtml } from '../../escape-html';
import { formatIstanbul } from '../../../lib/istanbul-time';
import { t, tf, dateLocale } from '../context';
import { chip, guardUnsaved, toast } from '../ui-kit';
import { refreshCounts, goBack } from '../shell';

interface ThreadSummary {
  id: string;
  recipient_email: string;
  recipient_name: string | null;
  subject: string;
  last_message_at: number;
  last_direction: string;
  unread: number;
  snippet: string;
  sender_email?: string;
  sender_name?: string | null;
}

interface Message {
  id: string;
  direction: string;
  from_email: string;
  from_name: string | null;
  body_html: string;
  attachment_count: number;
  sent_at: number;
}

const INBOX = '#eposta/gelen';
const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as unknown as T;

let isAdmin = false;
let isSender = false;
let threads: ThreadSummary[] | null = null;
// The thread on screen, and the one the address asks for (they differ while it loads).
let currentId: string | null = null;
let wantedId: string | null = null;
let started = false;
let listToken = 0;
let threadToken = 0;
let guard: { reset(): void } | null = null;

function errorText(code: unknown): string {
  // The conversations page's own wording first, then the shared mail codes.
  return t(`admin.mail.inbox.error.${String(code)}` as never)
    || t(`admin.mail.error.${String(code)}` as never)
    || t('admin.mail.reply.failed');
}

function scopeAll(): boolean {
  return isAdmin && el<HTMLInputElement>('mailInboxScopeAll').checked;
}

/** Ask the server to look for new mail. Best-effort: the cron does this too. */
async function refresh(): Promise<void> {
  try { await fetch('/api/mail/refresh', { method: 'POST' }); } catch { /* the cached list still renders */ }
}

async function loadThreads(): Promise<boolean> {
  const mine = ++listToken;
  let data: { threads: ThreadSummary[]; isAdmin?: boolean };
  try {
    const res = await fetch(scopeAll() ? '/api/mail/conversations?scope=all' : '/api/mail/conversations');
    if (!res.ok) throw new Error(String(res.status));
    data = await res.json();
  } catch {
    if (mine === listToken) toast(t('admin.mail.inbox.loadFailed'), true);
    return false;
  }
  if (mine !== listToken) return false;
  el('mailInboxScopeLabel').classList.toggle('hidden', data.isAdmin !== true);
  threads = data.threads ?? [];
  renderList();
  return true;
}

function renderList(): void {
  const list = el('mailInboxList');
  const rows = threads ?? [];
  el('mailInboxEmpty').classList.toggle('hidden', threads === null || rows.length > 0);
  list.innerHTML = rows.map((th) => {
    const selected = th.id === wantedId;
    const unread = th.unread ? chip(t('admin.mail.inbox.unread'), 'navy') : '';
    const sender = th.sender_email ? `<span class="text-[11px] text-gray-500 truncate min-w-0">${escapeHtml(th.sender_name || th.sender_email)}</span>` : '';
    return `
    <a href="${INBOX}/${escapeHtml(th.id)}" data-thread="${escapeHtml(th.id)}" ${selected ? 'aria-current="true"' : ''}
      class="block min-w-0 min-h-11 px-3 py-2 rounded-xl border transition-colors ${selected ? 'border-navy-mid bg-navy-light/40' : 'border-transparent hover:bg-[#F7F7F6]'}">
      <span class="flex items-baseline justify-between gap-2 min-w-0">
        <span class="text-sm truncate min-w-0 ${th.unread ? 'font-bold text-navy' : 'text-navy'}">${escapeHtml(th.recipient_name || th.recipient_email)}</span>
        <span class="text-[11px] text-gray-500 shrink-0">${escapeHtml(formatIstanbul(th.last_message_at, dateLocale))}</span>
      </span>
      <span class="block text-xs truncate ${th.unread ? 'font-semibold text-navy' : 'text-gray-500'}">${escapeHtml(th.subject)}</span>
      <span class="block text-xs text-gray-500 truncate">${th.last_direction === 'out' ? '&uarr; ' : '&darr; '}${escapeHtml(th.snippet)}</span>
      ${unread || sender ? `<span class="flex flex-wrap items-center gap-2 mt-1 min-w-0">${unread}${sender}</span>` : ''}
    </a>`;
  }).join('');
}

/** List alone, or the thread (with the list beside it from lg up). */
function layout(open: boolean): void {
  el('mailInboxListCard').classList.toggle('hidden', open);
  el('mailThreadCard').classList.toggle('hidden', !open);
  el('mailThreadEmpty').classList.toggle('hidden', open);
  if (!open) el('mailThreadView').classList.add('hidden');
}

async function openThread(id: string): Promise<void> {
  const mine = ++threadToken;
  let data: { thread: any; messages: Message[] };
  try {
    const res = await fetch(`/api/mail/conversations/${encodeURIComponent(id)}`);
    if (!res.ok) throw new Error(String(res.status));
    data = await res.json();
  } catch {
    if (mine !== threadToken) return;
    toast(t('admin.mail.inbox.openFailed'), true);
    if (currentId !== id) el('mailThreadEmpty').classList.remove('hidden');
    return;
  }
  if (mine !== threadToken || wantedId !== id) return;
  const changed = currentId !== id;
  currentId = id;
  renderThread(data.thread, data.messages ?? [], changed);

  // Opening one's own thread clears its unread flag on the server; an admin
  // reading someone else's leaves it, so only the owner's row and count move.
  if (data.thread?.can_reply === true) {
    const row = threads?.find((x) => x.id === id);
    if (!row || row.unread) {
      if (row) { row.unread = 0; renderList(); }
      void refreshCounts();
    }
  }
}

function renderThread(thread: any, messages: Message[], changed: boolean): void {
  el('mailThreadEmpty').classList.add('hidden');
  el('mailThreadView').classList.remove('hidden');
  el('mailThreadSubject').textContent = thread.subject ?? '';
  el('mailThreadWith').textContent = thread.recipient_name
    ? `${thread.recipient_name} <${thread.recipient_email}>`
    : thread.recipient_email ?? '';

  el('mailThreadMessages').innerHTML = messages.map((m) => {
    const out = m.direction === 'out';
    const muted = out ? 'text-white/70' : 'text-gray-500';
    return `
    <div class="flex ${out ? 'justify-end' : 'justify-start'} min-w-0">
      <div class="max-w-[85%] min-w-0 break-words rounded-2xl px-4 py-3 ${out ? 'bg-navy text-white' : 'bg-white border border-border text-navy'}">
        <div class="text-[11px] mb-1 ${muted}">
          ${escapeHtml(out ? 'RSG-Türkiye' : (m.from_name || m.from_email))} &middot; ${escapeHtml(formatIstanbul(m.sent_at, dateLocale))}
        </div>
        <!-- body_html is produced by renderPlainWithLinks on the server: the
             correspondent's text is escaped there and only tags that function
             emitted survive. It is the one field here inserted as HTML. -->
        <div class="mail-body text-sm leading-relaxed">${m.body_html}</div>
        ${m.attachment_count > 0 ? `<div class="text-[11px] mt-2 ${muted}">${escapeHtml(tf('admin.mail.inbox.attachments', { count: m.attachment_count }))}</div>` : ''}
      </div>
    </div>`;
  }).join('');

  // The server refuses a reply from anyone but the member who started the
  // thread, and from them too once they are no longer a sender, so the form
  // shows only to an owner who can send.
  const owner = thread.can_reply === true;
  const canReply = owner && isSender;
  el('mailReplyWrap').classList.toggle('hidden', !canReply);
  el('mailReplyBlocked').classList.toggle('hidden', canReply);
  el('mailReplyBlocked').textContent = t(owner ? 'admin.mail.reply.notSender' : 'admin.mail.reply.blocked');
  // A refresh of the same thread keeps a half-written reply.
  if (changed) resetReply();
}

function resetReply(): void {
  el<HTMLFormElement>('mailReplyForm').reset();
  guard?.reset();
}

async function submitReply(): Promise<void> {
  const id = currentId;
  if (!id) return;
  const textarea = el<HTMLTextAreaElement>('mailReplyBody');
  const button = el<HTMLButtonElement>('mailReplySend');
  const status = el('mailReplyStatus');
  const body = textarea.value.trim();
  if (body === '') return;

  button.disabled = true;
  status.textContent = t('admin.mail.compose.sending');
  try {
    const res = await fetch(`/api/mail/conversations/${encodeURIComponent(id)}/reply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body }),
    });
    const data: any = await res.json().catch(() => null);
    if (!res.ok || data?.ok !== true) {
      toast(data?.code ? errorText(data.code) : t('admin.mail.reply.failed'), true);
      return;
    }
    // Cleared only once the reply has gone: the words exist nowhere else.
    resetReply();
    toast(t('admin.mail.reply.sent'));
    if (currentId === id) await openThread(id);
  } catch {
    toast(t('admin.mail.reply.failed'), true);
  } finally {
    button.disabled = false;
    status.textContent = '';
  }
}

/** Wires the controls once, before the shell first shows the pane. */
export function setupInbox(opts: { isAdmin: boolean; isSender: boolean }): void {
  isAdmin = opts.isAdmin;
  isSender = opts.isSender;
  const form = el<HTMLFormElement>('mailReplyForm');
  // `exact`: another thread or the bare list replaces this one, so both warn.
  guard = guardUnsaved(form, INBOX, () => { el<HTMLFormElement>('mailReplyForm').reset(); }, { exact: true });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    void submitReply();
  });

  el('mailInboxRefresh').addEventListener('click', async () => {
    await refresh();
    await loadThreads();
    // The thread the address asks for, which differs from the one on screen
    // after a failed open: Refresh retries it.
    if (wantedId) await openThread(wantedId);
  });

  // Phone: ‹ steps back to the list it came from rather than pushing the
  // list again, as the shell's own back does (which hides on a thread).
  el('mailInboxBack').addEventListener('click', (e) => {
    e.preventDefault();
    goBack();
  });

  if (isAdmin) {
    el('mailInboxScopeAll').addEventListener('change', () => {
      void loadThreads();
      // The open thread may not be in the new list; go back to the list.
      if (wantedId) location.hash = INBOX;
    });
  }
}

/** Shows the list, and the thread `item` names (null: none). Runs on every show of the sub-page. */
export async function showInbox(item: string | null): Promise<void> {
  wantedId = item;
  layout(item !== null);
  if (item === null) currentId = null;
  renderList();

  if (!started) {
    started = true;
    // Render the cache first so the page is useful at once, then ask Gmail
    // and render again. The thread below does not wait for either.
    void loadThreads().then(async (ok) => {
      if (!ok) { started = false; return; }
      await refresh();
      await loadThreads();
    });
  }

  if (item !== null && item !== currentId) {
    el('mailThreadView').classList.add('hidden');
    await openThread(item);
  }
}
