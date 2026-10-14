/**
 * Sosyal's Messages sub-page (#sosyal/dm, publishers and admins): the
 * Instagram conversations the server has seen, and one conversation fetched
 * live with a reply box. Laid out like the e-mail inbox: list and thread side
 * by side from lg up; on a phone the list, then the thread with ‹ back.
 * Message text is shown with textContent-equivalent escaping, never as HTML.
 */
import { escapeHtml } from '../../escape-html';
import { formatIstanbul } from '../../../lib/istanbul-time';
import { utf8Bytes } from '../../../lib/utf8-bytes';
import { t, tf, dateLocale } from '../context';
import { chip, guardUnsaved, toast } from '../ui-kit';
import { refreshCounts, goBack } from '../shell';

interface ThreadOut {
  id: string; username: string | null; lastAt: number; lastInboundAt: number | null;
  unanswered: boolean; unread: boolean; expired: boolean; closesAt: number | null; secondsLeft: number;
}
interface Msg { id: string; at: number; mine: boolean; text: string; attachments: string[] }

const HASH = '#sosyal/dm';
const MAX_BYTES = 1000;
const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as unknown as T;

export { utf8Bytes };

let threads: ThreadOut[] | null = null;
let onlyUnanswered = true;
let wantedId: string | null = null;
let currentId: string | null = null;
let started = false;
let listToken = 0;
let threadToken = 0;
let guard: { reset(): void } | null = null;

const who = (th: { username: string | null }) => th.username ? `@${th.username}` : t('admin.social.dm.unknownUser');

function stateChip(th: ThreadOut): string {
  if (!th.unanswered) return chip(t('admin.social.dm.answered'), 'neutral');
  if (th.expired) return chip(t('admin.social.dm.expired'), 'neutral');
  const h = Math.max(1, Math.floor(th.secondsLeft / 3600));
  return chip(tf('admin.social.dm.hoursLeft', { n: h }), th.secondsLeft < 4 * 3600 ? 'amber' : 'navy');
}

async function loadThreads(): Promise<boolean> {
  const mine = ++listToken;
  let data: { status: string; account: string | null; linkedin: boolean; threads: ThreadOut[] };
  try {
    const res = await fetch('/api/admin/social/dm');
    if (!res.ok) throw new Error(String(res.status));
    data = await res.json();
  } catch {
    if (mine === listToken) toast(t('admin.social.dm.loadFailed'), true);
    return false;
  }
  if (mine !== listToken) return false;
  const status = el('dmStatus');
  status.classList.toggle('hidden', data.status === 'ok');
  status.textContent = data.status === 'ok' ? '' : t(`admin.social.dm.status.${data.status}` as never);
  el('dmLinkedin').classList.toggle('hidden', !data.linkedin);
  threads = data.threads ?? [];
  renderList();
  return true;
}

function renderList(): void {
  const rows = (threads ?? []).filter((th) => !onlyUnanswered || (th.unanswered && !th.expired) || th.id === wantedId);
  el('dmEmpty').classList.toggle('hidden', threads === null || rows.length > 0);
  el('dmList').innerHTML = rows.map((th) => {
    const selected = th.id === wantedId;
    return `
    <a href="${HASH}/${escapeHtml(th.id)}" data-dm="${escapeHtml(th.id)}" ${selected ? 'aria-current="true"' : ''}
      class="block min-w-0 min-h-11 px-3 py-2 rounded-xl border transition-colors ${selected ? 'border-navy-mid bg-navy-light/40' : 'border-transparent hover:bg-[#F7F7F6]'}">
      <span class="flex items-baseline justify-between gap-2 min-w-0">
        <span class="text-sm truncate min-w-0 text-navy ${th.unread ? 'font-bold' : ''}">${escapeHtml(who(th))}</span>
        <span class="text-[11px] text-gray-500 shrink-0">${th.lastAt ? escapeHtml(formatIstanbul(th.lastAt, dateLocale)) : ''}</span>
      </span>
      <span class="flex flex-wrap items-center gap-2 mt-1">${th.unread ? chip(t('admin.social.dm.unread'), 'navy') : ''}${stateChip(th)}</span>
    </a>`;
  }).join('');
}

function layout(open: boolean): void {
  el('dmListCard').classList.toggle('hidden', open);
  el('dmThreadCard').classList.toggle('hidden', !open);
  el('dmThreadEmpty').classList.toggle('hidden', open);
  if (!open) el('dmThreadView').classList.add('hidden');
}

function setReplyOpen(open: boolean): void {
  const form = el('dmReplyForm');
  form.classList.toggle('hidden', !open);
  form.classList.toggle('flex', open);
  el('dmClosed').classList.toggle('hidden', open);
}

function updateBytes(): void {
  const n = utf8Bytes(el<HTMLTextAreaElement>('dmReplyText').value.trim());
  el('dmBytes').textContent = tf('admin.social.dm.bytes', { n });
  el('dmBytes').classList.toggle('text-red', n > MAX_BYTES);
  el<HTMLButtonElement>('dmSend').disabled = n === 0 || n > MAX_BYTES;
}

async function openThread(id: string): Promise<void> {
  const mine = ++threadToken;
  let data: { thread: ThreadOut; messages: Msg[] | null; error?: string };
  try {
    const res = await fetch(`/api/admin/social/dm/${encodeURIComponent(id)}`);
    if (!res.ok) throw new Error(String(res.status));
    data = await res.json();
  } catch {
    if (mine === threadToken) toast(t('admin.social.dm.threadFailed'), true);
    return;
  }
  if (mine !== threadToken || wantedId !== id) return;
  const changed = currentId !== id;
  currentId = id;
  if (changed) el('dmThreadCard').scrollTop = 0;
  el('dmThreadEmpty').classList.add('hidden');
  el('dmThreadView').classList.remove('hidden');
  el('dmThreadWho').textContent = who(data.thread);
  const err = el('dmThreadError');
  err.classList.toggle('hidden', !data.error);
  err.textContent = data.error ? t(data.error === 'connection' ? 'admin.social.dm.error.connection' : 'admin.social.dm.threadFailed') : '';
  el('dmMessages').innerHTML = (data.messages ?? []).map((m) => `
    <div class="flex ${m.mine ? 'justify-end' : 'justify-start'} min-w-0">
      <div class="max-w-[85%] min-w-0 break-words whitespace-pre-wrap rounded-2xl px-4 py-3 lg:px-3 lg:py-2 ${m.mine ? 'bg-navy text-white' : 'bg-white border border-border text-navy'}">
        <div class="text-[11px] mb-1 ${m.mine ? 'text-white/70' : 'text-gray-500'}">${escapeHtml(m.mine ? t('admin.social.dm.you') : who(data.thread))} &middot; ${escapeHtml(formatIstanbul(m.at, dateLocale))}</div>
        <div class="text-sm leading-relaxed">${escapeHtml(m.text)}</div>
        ${m.attachments.map((u) => `<a href="${escapeHtml(u)}" target="_blank" rel="noopener noreferrer" class="block text-[11px] underline mt-1">${escapeHtml(t('admin.social.dm.attachment'))}</a>`).join('')}
      </div>
    </div>`).join('');
  // Answerable while the window is open, answered or not: a follow-up is allowed too.
  // No messages (connection trouble) means no reply box either.
  setReplyOpen(data.thread.closesAt !== null && !data.thread.expired && data.messages !== null);
  if (changed) { el<HTMLFormElement>('dmReplyForm').reset(); guard?.reset(); }
  updateBytes();
  const row = threads?.find((x) => x.id === id);
  if (row?.unread) { row.unread = false; renderList(); }
  void refreshCounts();
}

async function submitReply(): Promise<void> {
  const id = currentId;
  if (!id) return;
  const box = el<HTMLTextAreaElement>('dmReplyText');
  const text = box.value.trim();
  if (!text || utf8Bytes(text) > MAX_BYTES) return;
  const button = el<HTMLButtonElement>('dmSend');
  button.disabled = true;
  el('dmBytes').textContent = t('admin.social.dm.sending');
  try {
    const res = await fetch(`/api/admin/social/dm/${encodeURIComponent(id)}/reply`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }),
    });
    const data: any = await res.json().catch(() => null);
    if (!res.ok || data?.ok !== true) {
      const code = typeof data?.code === 'string' ? data.code : 'unavailable';
      toast(t(`admin.social.dm.error.${code}` as never) || t('admin.social.dm.error.unavailable'), true);
      if (code === 'window_closed') setReplyOpen(false);
      return;
    }
    // Cleared only once it has gone: the words exist nowhere else.
    el<HTMLFormElement>('dmReplyForm').reset();
    guard?.reset();
    toast(t('admin.social.dm.sent'));
    await loadThreads();
    if (currentId === id) await openThread(id);
  } catch {
    toast(t('admin.social.dm.error.unavailable'), true);
  } finally {
    updateBytes();
  }
}

function setFilter(unanswered: boolean): void {
  onlyUnanswered = unanswered;
  el('dmFilterUnanswered').setAttribute('aria-pressed', String(unanswered));
  el('dmFilterAll').setAttribute('aria-pressed', String(!unanswered));
  renderList();
}

/** Wires the controls once, before the shell first shows the sub-page. */
export function setupDm(): void {
  const form = el<HTMLFormElement>('dmReplyForm');
  if (!form) return;
  guard = guardUnsaved(form, HASH, () => { form.reset(); }, { exact: true });
  form.addEventListener('submit', (e) => { e.preventDefault(); void submitReply(); });
  el('dmReplyText').addEventListener('input', updateBytes);
  el('dmFilterUnanswered').addEventListener('click', () => setFilter(true));
  el('dmFilterAll').addEventListener('click', () => setFilter(false));
  el('dmRefresh').addEventListener('click', async () => {
    const b = el<HTMLButtonElement>('dmRefresh');
    b.disabled = true;
    try { await fetch('/api/admin/social/dm/refresh', { method: 'POST' }); } catch { /* the list below still loads */ }
    await loadThreads();
    if (wantedId) await openThread(wantedId);
    b.disabled = false;
  });
  el('dmBack').addEventListener('click', (e) => { e.preventDefault(); goBack(); });
}

/** Shows the list, and the conversation `item` names (null: none). Runs on every show of the sub-page. */
export async function showDm(item: string | null): Promise<void> {
  if (!document.getElementById('dmList')) return;
  wantedId = item;
  layout(item !== null);
  if (item === null) currentId = null;
  renderList();
  if (!started) {
    started = true;
    void loadThreads().then((ok) => { if (!ok) started = false; });
  }
  if (item !== null && item !== currentId) {
    el('dmThreadView').classList.add('hidden');
    await openThread(item);
  }
}
