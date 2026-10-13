/** The approval queue (publishers) and the undated drafts list. */
import { api, ApiError, type Post } from './api';
import { deps, changed } from './context';
import { errorText } from './messages';
import { esc, button, armConfirm } from './ui';
import { bgImage } from './preview';
import { openComposer } from './composer';
import { dayKey, timeOf } from '../../lib/social-calendar';

const STALE_CODES = ['post_changed', 'not_found', 'not_pending', 'plan_taken', 'plan_has_post'];

const when = (e: number | null) => (e ? `${dayKey(e)} ${timeOf(e)}` : '');

function card(p: Post, actions: string): string {
  const { t } = deps();
  const thumb = p.media[0]
    ? `<div class="w-16 h-20 shrink-0 rounded bg-gray-200 bg-center bg-cover" style="${bgImage(p.media[0].url)}"></div>`
    : '<div class="w-16 h-20 shrink-0 rounded bg-gray-100"></div>';
  const alts = p.media.filter((m) => m.alt.trim()).length;
  return `<div data-post="${esc(p.id)}" class="flex gap-3 p-3 mb-3 bg-white rounded-2xl border border-border">${thumb}
    <div class="flex-1 min-w-0"><p class="font-medium text-navy truncate">${esc(p.planTitle || p.caption.split('\n')[0] || t(`admin.social.type.${p.type}`))}</p>
      <p class="text-xs text-gray-500">${esc(t(`admin.social.type.${p.type}`))} · ${esc(p.platforms.map((x) => t(`admin.connections.platform.${x}`)).join(' + '))} · ${esc(when(p.scheduledAt))} · ${esc(p.authorEmail ?? '')} · ${alts}/${p.media.length} alt</p>
      <div class="flex flex-wrap gap-2 mt-2">${actions}</div>
      <div data-reject class="hidden mt-2"><textarea rows="2" maxlength="500" class="w-full px-2 py-1 rounded-lg border border-border text-sm" placeholder="${esc(t('admin.social.rejectNote'))}"></textarea>
        ${button(t('admin.social.action.rejectConfirm'), 'data-act="rejectSend"', 'danger')}</div></div></div>`;
}

async function act(work: () => Promise<unknown>, doneKey: string): Promise<void> {
  const { t, showToast } = deps();
  try {
    await work();
    showToast(t(doneKey));
    changed();
  } catch (err) {
    showToast(errorText(err), true);
    // The revision or state is stale: reload so the list shows the current posts.
    if (err instanceof ApiError && STALE_CODES.includes(err.code)) changed();
  }
}

export async function refreshPendingCount(): Promise<void> {
  if (!deps().me.isPublisher) return;
  const n = (await api.pending()).length;
  const pill = document.getElementById('socialPendingCount');
  if (!pill) return;
  pill.textContent = String(n);
  pill.classList.toggle('hidden', n === 0);
}

export async function loadPending(): Promise<void> {
  const { t } = deps();
  const list = document.getElementById('socialPendingList');
  if (!list) return;
  const posts = await api.pending();
  list.innerHTML = posts.map((p) => card(p, [
    button(t('admin.social.action.approve'), 'data-act="approve"', 'ok'),
    button(t('admin.social.action.open'), 'data-act="open"'),
    button(t('admin.social.action.reject'), 'data-act="reject"', 'danger'),
  ].join(''))).join('') || `<p class="text-sm text-gray-500">${esc(t('admin.social.empty'))}</p>`;
  for (const p of posts) {
    const el = list.querySelector<HTMLElement>(`[data-post="${CSS.escape(p.id)}"]`)!;
    el.querySelector('[data-act="approve"]')!.addEventListener('click', () => void act(() => api.action(p.id, 'approve', { revision: p.revision }), 'admin.social.done.approved'));
    el.querySelector('[data-act="open"]')!.addEventListener('click', () => void openComposer({ postId: p.id }));
    el.querySelector('[data-act="reject"]')!.addEventListener('click', () => el.querySelector('[data-reject]')!.classList.remove('hidden'));
    el.querySelector('[data-act="rejectSend"]')!.addEventListener('click', () => {
      const note = el.querySelector<HTMLTextAreaElement>('[data-reject] textarea')!.value.trim();
      void act(() => api.action(p.id, 'reject', { revision: p.revision, note }), 'admin.social.done.rejected');
    });
  }
}

export async function loadDrafts(): Promise<void> {
  const { t } = deps();
  const list = document.getElementById('socialDraftList');
  if (!list) return;
  const posts = await api.drafts();
  list.innerHTML = posts.map((p) => card(p, [
    button(t('admin.social.action.edit'), 'data-act="open"', 'primary'),
    button(t('admin.social.action.delete'), 'data-act="delete"', 'danger'),
  ].join(''))).join('') || `<p class="text-sm text-gray-500">${esc(t('admin.social.empty'))}</p>`;
  for (const p of posts) {
    const el = list.querySelector<HTMLElement>(`[data-post="${CSS.escape(p.id)}"]`)!;
    el.querySelector('[data-act="open"]')!.addEventListener('click', () => void openComposer({ postId: p.id }));
    armConfirm(el.querySelector<HTMLButtonElement>('[data-act="delete"]')!, () => act(() => api.deletePost(p.id, p.revision), 'admin.social.done.deleted'));
  }
}
